"use client";
import StorageSetupForm from "@/components/StorageSetupForm";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export default function StorageSetupModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="w-full max-w-lg rounded-xl border border-ink-700 bg-ink-900 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <header className="px-5 py-4 border-b border-ink-700 flex justify-between items-center bg-ink-950/40">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ice-100">
            Storage Warehouse Setup
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition text-sm font-semibold"
          >
            ✕
          </button>
        </header>
        <div className="p-5">
          <StorageSetupForm
            showCancel={true}
            onCancel={onClose}
            onSuccess={() => {
              onClose();
              window.location.reload();
            }}
          />
        </div>
      </div>
    </div>
  );
}
