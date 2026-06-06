import { NextRequest, NextResponse } from "next/server";
import { getObjectBuffer } from "@/lib/storage";
import { listNamespaces, listTables, loadTable } from "@/lib/lakekeeper";
import { readManifestList, readManifest } from "@/lib/avro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LineageNode = {
  id: string;
  kind:
    | "catalog"
    | "metadata-json"
    | "manifest-list"
    | "manifest"
    | "data"
    | "delete-puffin"
    | "delete-parquet"
    | "stats-puffin";
  label: string;
  bytes?: number;
  snapshotId?: string;
  partition?: string;
  meta?: Record<string, any>;
};
export type LineageEdge = { from: string; to: string; kind: "points-to" | "shadows" };
export type LineageGraph = { table: string; nodes: LineageNode[]; edges: LineageEdge[]; error?: string };

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// Object-store location -> bucket-relative key. Lakekeeper records absolute
// s3://… (MinIO) or gs://… (GCS) URIs.
function keyOf(uri: string): string {
  const m = uri.match(/^(?:s3|gs):\/\/[^/]+\/(.+)$/);
  return m ? m[1] : uri;
}

async function buildOne(ns: string[], table: string): Promise<LineageGraph> {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  const seenEdge = new Set<string>();
  const walkedManifests = new Set<string>();
  const add = (n: LineageNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
  const link = (from: string, to: string, kind: LineageEdge["kind"] = "points-to") => {
    const k = `${from}|${to}|${kind}`;
    if (seenEdge.has(k)) return;
    seenEdge.add(k);
    edges.push({ from, to, kind });
  };

  try {
    const t = await loadTable(ns, table);
    if (!t) return { table, nodes, edges, error: "table not found" };
    const meta = t.metadata;
    const metaLoc: string | undefined = t["metadata-location"] ?? t.metadataLocation;

    const catalogId = `catalog:${ns.join(".")}.${table}`;
    add({ id: catalogId, kind: "catalog", label: `${ns.join(".")}.${table}` });

    const metaKey = metaLoc ? keyOf(metaLoc) : `meta:${table}`;
    add({
      id: metaKey,
      kind: "metadata-json",
      label: metaLoc ? basename(metaLoc) : "metadata.json",
      snapshotId: String(meta?.["current-snapshot-id"] ?? ""),
      meta: {
        formatVersion: meta?.["format-version"],
        schemaId: meta?.["current-schema-id"],
        properties: meta?.properties,
        snapshots: (meta?.snapshots ?? []).map((s: any) => ({
          id: String(s["snapshot-id"]),
          parent: s["parent-snapshot-id"] != null ? String(s["parent-snapshot-id"]) : null,
          sequenceNumber: s["sequence-number"],
          operation: s?.summary?.operation,
          timestamp: s["timestamp-ms"],
        })),
        refs: meta?.refs,
      },
    });
    link(catalogId, metaKey);

    // V3 Puffin statistics blobs registered in metadata.json under
    // `statistics[]`. Each entry pins a Puffin file to a snapshot.
    const statsList: any[] = meta?.statistics ?? [];
    for (const stat of statsList) {
      const statUri: string | undefined = stat?.["statistics-path"] ?? stat?.statisticsPath;
      if (!statUri) continue;
      const statKey = keyOf(statUri);
      add({
        id: statKey,
        kind: "stats-puffin",
        label: basename(statUri),
        snapshotId: stat?.["snapshot-id"] != null ? String(stat["snapshot-id"]) : undefined,
        bytes: stat?.["file-size-in-bytes"] ?? stat?.fileSizeInBytes,
        meta: {
          blobMetadata: stat?.["blob-metadata"] ?? stat?.blobMetadata,
          fileFooterSize: stat?.["file-footer-size-in-bytes"],
        },
      });
      // Attach to the matching snapshot's manifest-list node if present;
      // fall back to the metadata.json node.
      const snapId = stat?.["snapshot-id"];
      const snap = (meta?.snapshots ?? []).find((s: any) => s["snapshot-id"] === snapId);
      const mlUri: string | undefined = snap?.["manifest-list"];
      if (mlUri) link(keyOf(mlUri), statKey);
      else link(metaKey, statKey);
    }

    const snapshots: any[] = meta?.snapshots ?? [];
    for (const snap of snapshots) {
      const mlUri: string | undefined = snap["manifest-list"];
      if (!mlUri) continue;
      const mlKey = keyOf(mlUri);
      add({
        id: mlKey,
        kind: "manifest-list",
        label: basename(mlUri),
        snapshotId: String(snap["snapshot-id"]),
        meta: { operation: snap?.summary?.operation, summary: snap?.summary, parent: snap["parent-snapshot-id"] },
      });
      link(metaKey, mlKey);

      let mlEntries: any[] = [];
      try {
        const buf = await getObjectBuffer(mlKey);
        mlEntries = await readManifestList(buf);
      } catch (e: any) {
        console.error(`[lineage] manifest-list read failed for ${mlKey}:`, e?.message ?? e);
        continue;
      }

      for (const mle of mlEntries) {
        const manKey = keyOf(mle.manifestPath);
        add({
          id: manKey,
          kind: "manifest",
          label: basename(manKey),
          meta: {
            content: mle.content,
            addedDataFiles: mle.addedDataFiles,
            existingDataFiles: mle.existingDataFiles,
            deletedDataFiles: mle.deletedDataFiles,
            partitionSpecId: mle.partitionSpecId,
          },
        });
        link(mlKey, manKey);

        // A manifest is immutable; multiple snapshots' manifest-lists routinely
        // reference the same manifest (MoR keeps the data manifest stable while
        // adding delete manifests). Walk each manifest exactly once.
        if (walkedManifests.has(manKey)) continue;
        walkedManifests.add(manKey);

        let mEntries: any[] = [];
        try {
          const buf = await getObjectBuffer(manKey);
          mEntries = await readManifest(buf);
        } catch (e: any) {
          console.error(`[lineage] manifest read failed for ${manKey}:`, e?.message ?? e);
          continue;
        }

        // Keep node count bounded; a 50M-row table can have hundreds of files
        // per manifest, which the SVG layout cannot show usefully.
        const MAX_PER_MANIFEST = 24;
        const trimmed = mEntries.filter((e) => e.status !== 2 && e.filePath);
        const elided = Math.max(0, trimmed.length - MAX_PER_MANIFEST);
        const shown = trimmed.slice(0, MAX_PER_MANIFEST);
        for (const me of shown) {
          if (me.status === 2) continue;
          if (!me.filePath) continue;
          const fKey = keyOf(me.filePath);
          const isDelete = me.content === 1 || me.content === 2;
          const isPuffin = me.fileFormat === "puffin";
          const kind: LineageNode["kind"] = isDelete
            ? (isPuffin ? "delete-puffin" : "delete-parquet")
            : "data";
          add({
            id: fKey,
            kind,
            label: basename(fKey),
            bytes: me.fileSizeInBytes,
            partition: me.partition ? JSON.stringify(me.partition) : undefined,
            meta: {
              recordCount: me.recordCount,
              fileFormat: me.fileFormat,
              status: me.status,
            },
          });
          link(manKey, fKey);

          // Puffin DV manifests carry referenced_data_file; positional V2
          // deletes reference via the same field. Draw a 'shadows' edge.
          if (isDelete && me.referencedDataFile) {
            link(fKey, keyOf(me.referencedDataFile), "shadows");
          }
        }
        if (elided > 0) {
          const moreId = `${manKey}#more`;
          add({ id: moreId, kind: "data", label: `+${elided} more files`, meta: { elided } });
          link(manKey, moreId);
        }
      }
    }
  } catch (e: any) {
    return { table, nodes, edges, error: e?.message ?? String(e) };
  }
  return { table, nodes, edges };
}

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table");
  const ns = (req.nextUrl.searchParams.get("ns") ?? "market").split(".");

  try {
    if (table) {
      const g = await buildOne(ns, table);
      return NextResponse.json(g);
    }
    const namespaces = await listNamespaces();
    const graphs: LineageGraph[] = [];
    for (const n of namespaces) {
      const tables = await listTables(n);
      for (const t of tables) graphs.push(await buildOne(n, t));
    }
    return NextResponse.json({ graphs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
