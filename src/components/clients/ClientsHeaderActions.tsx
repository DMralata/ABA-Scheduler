"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, Plus, Users } from "lucide-react";
import { BulkClientImport } from "@/components/clients/BulkClientImport";

export function ClientsHeaderActions() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <div ref={ref} className="relative inline-flex">
        <Link
          href="/clients/new"
          className="ata-btn ata-btn--primary"
          style={{
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
            borderRight: "1px solid rgba(255,255,255,0.18)",
          }}
        >
          <Plus size={16} />
          Add Client
        </Link>
        <button
          type="button"
          className="ata-btn ata-btn--primary"
          onClick={() => setDropdownOpen((o) => !o)}
          aria-label="More add options"
          style={{
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            padding: "0 10px",
          }}
        >
          <ChevronDown size={14} />
        </button>

        {dropdownOpen && (
          <div
            className="absolute right-0 z-50 ata-card"
            style={{
              top: "calc(100% + 6px)",
              width: 224,
              padding: 6,
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <Link
              href="/clients/new"
              className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-md hover:bg-ata-gray-50"
              onClick={() => setDropdownOpen(false)}
            >
              <Plus size={14} className="shrink-0" />
              Add single client
            </Link>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md hover:bg-ata-gray-50"
              onClick={() => {
                setDropdownOpen(false);
                setBulkOpen(true);
              }}
            >
              <Users size={14} className="shrink-0" />
              Import multiple clients
            </button>
          </div>
        )}
      </div>

      <BulkClientImport open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </>
  );
}
