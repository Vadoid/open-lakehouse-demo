"use client";
import { useEffect, useState } from "react";

interface DynamicLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  port: number;
  path?: string;
}

export default function DynamicLink({ port, path = "", children, ...props }: DynamicLinkProps) {
  const [href, setHref] = useState(`http://localhost:${port}${path}`);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHref(`http://${window.location.hostname}:${port}${path}`);
    }
  }, [port, path]);

  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
