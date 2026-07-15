"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Trash2,
  CalendarDays,
  ChevronUp,
  ClipboardPaste,
  FileSpreadsheet,
  Download,
} from "lucide-react";
import { createClientsInBulk } from "@/lib/actions/clients";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RowData {
  firstName: string;
  lastName: string;
  externalId: string;
  dateOfBirth: string;
  gender: string;
  spanish: string;
  femaleProviderOnly: string;
  insurance: string;
  activeDate: string;
  preferredLocation: string;
  minimumRbtLevel: string;
  defaultSessionHours: string;
}

type RowErrors = Partial<Record<keyof RowData, string>>;

interface AvailWindow {
  startTime: string;
  endTime: string;
}

// dayKey → window (only enabled days have an entry)
type RowAvailability = Record<string, AvailWindow>;

const emptyRow = (): RowData => ({
  firstName: "",
  lastName: "",
  externalId: "",
  dateOfBirth: "",
  gender: "",
  spanish: "no",
  femaleProviderOnly: "no",
  insurance: "",
  activeDate: "",
  preferredLocation: "CENTER",
  minimumRbtLevel: "",
  defaultSessionHours: "",
});

const MAX_ROWS = 50;

const DAYS = [
  { key: "MONDAY", label: "Monday" },
  { key: "TUESDAY", label: "Tuesday" },
  { key: "WEDNESDAY", label: "Wednesday" },
  { key: "THURSDAY", label: "Thursday" },
  { key: "FRIDAY", label: "Friday" },
  { key: "SATURDAY", label: "Saturday" },
  { key: "SUNDAY", label: "Sunday" },
] as const;

type DayKey = (typeof DAYS)[number]["key"];

// ─── Column Definitions ───────────────────────────────────────────────────────

type CellProps = {
  value: string;
  onChange: (val: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLElement>) => void;
  error?: string;
};

interface Column {
  key: keyof RowData;
  header: string;
  width: string;
  renderCell: (props: CellProps) => React.ReactNode;
}

function inputClass(error?: string) {
  return `h-8 w-full min-w-0 rounded border px-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring ${
    error ? "border-red-400 bg-red-50" : "border-input"
  }`;
}

function selectClass(error?: string) {
  return `h-8 w-full min-w-0 rounded border px-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring ${
    error ? "border-red-400 bg-red-50" : "border-input"
  }`;
}

const COLUMNS: Column[] = [
  {
    key: "firstName",
    header: "First Name *",
    width: "120px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="First" title={error} />
    ),
  },
  {
    key: "lastName",
    header: "Last Name *",
    width: "120px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="Last" title={error} />
    ),
  },
  {
    key: "externalId",
    header: "External ID *",
    width: "110px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="EMR ID" title={error} />
    ),
  },
  {
    key: "dateOfBirth",
    header: "Date of Birth *",
    width: "140px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input type="date" className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} title={error} />
    ),
  },
  {
    key: "gender",
    header: "Gender *",
    width: "100px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <select className={selectClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} title={error}>
        <option value="">—</option>
        <option value="Male">Male</option>
        <option value="Female">Female</option>
      </select>
    ),
  },
  {
    key: "spanish",
    header: "Spanish",
    width: "90px",
    renderCell: ({ value, onChange, onPaste }) => (
      <select className={selectClass()} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste}>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    ),
  },
  {
    key: "femaleProviderOnly",
    header: "Female Only",
    width: "105px",
    renderCell: ({ value, onChange, onPaste }) => (
      <select className={selectClass()} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste}>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    ),
  },
  {
    key: "insurance",
    header: "Insurance *",
    width: "140px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="Funding source" title={error} />
    ),
  },
  {
    key: "activeDate",
    header: "Active Date *",
    width: "140px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input type="date" className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} title={error} />
    ),
  },
  {
    key: "preferredLocation",
    header: "Location",
    width: "100px",
    renderCell: ({ value, onChange, onPaste }) => (
      <select className={selectClass()} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste}>
        <option value="CENTER">Center</option>
        <option value="HOME">Home</option>
        <option value="HYBRID">Hybrid</option>
        <option value="SCHOOL">School</option>
      </select>
    ),
  },
  {
    key: "minimumRbtLevel",
    header: "Min RBT",
    width: "100px",
    renderCell: ({ value, onChange, onPaste }) => (
      <select className={selectClass()} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste}>
        <option value="">None</option>
        <option value="I">Level I+</option>
        <option value="II">Level II+</option>
        <option value="III">Level III</option>
      </select>
    ),
  },
  {
    key: "defaultSessionHours",
    header: "Hours/Day",
    width: "90px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input type="number" className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="—" min={2} max={8} step={0.5} title={error} />
    ),
  },
];

// ─── Paste parser ─────────────────────────────────────────────────────────────

const PASTE_FIELD_ORDER: (keyof RowData)[] = [
  "firstName", "lastName", "externalId", "dateOfBirth",
  "gender", "spanish", "femaleProviderOnly", "insurance",
  "activeDate", "preferredLocation", "minimumRbtLevel", "defaultSessionHours",
];

function normalizePastedValue(field: keyof RowData, raw: string): string {
  const v = raw.trim();
  switch (field) {
    case "gender": {
      const l = v.toLowerCase();
      if (l === "male") return "Male";
      if (l === "female") return "Female";
      return v;
    }
    case "spanish":
    case "femaleProviderOnly": {
      const l = v.toLowerCase();
      return l === "yes" || l === "true" || l === "1" ? "yes" : "no";
    }
    case "preferredLocation": {
      const l = v.toLowerCase();
      if (l === "home") return "HOME";
      if (l === "hybrid") return "HYBRID";
      if (l === "school") return "SCHOOL";
      return "CENTER";
    }
    case "minimumRbtLevel": {
      const l = v.toLowerCase().trim();
      if (!l || l === "none" || l === "0") return "";
      if (l === "i" || l === "1" || l.includes("level i")) return "I";
      if (l === "ii" || l === "2" || l.includes("level ii")) return "II";
      if (l === "iii" || l === "3" || l.includes("level iii")) return "III";
      return "";
    }
    default:
      return v;
  }
}

// ─── Bulk paste / file import helpers ────────────────────────────────────────

const TEMPLATE_HEADERS = [
  "First Name",
  "Last Name",
  "External ID",
  "Date of Birth",
  "Gender",
  "Spanish",
  "Female Provider Only",
  "Insurance",
  "Active Date",
  "Preferred Location",
  "Min RBT Level",
  "Default Session Hours",
];

const TEMPLATE_SAMPLE: string[] = [
  "Olivia",
  "Davis",
  "C-004",
  "2018-08-15",
  "Female",
  "no",
  "no",
  "Blue Cross Blue Shield",
  "2024-01-02",
  "HOME",
  "II",
  "4",
];

function looksLikeHeaderRow(cells: string[]): boolean {
  const first = (cells[0] ?? "").trim().toLowerCase();
  return (
    first === "first name" ||
    first === "firstname" ||
    first === "first" ||
    first === "client first name"
  );
}

function rowsFromMatrix(matrix: string[][]): RowData[] {
  if (matrix.length === 0) return [];
  let body = matrix;
  if (looksLikeHeaderRow(matrix[0])) body = matrix.slice(1);
  // Trim trailing empty rows
  while (body.length > 0 && body[body.length - 1].every((c) => !c.trim())) {
    body = body.slice(0, -1);
  }
  return body.slice(0, MAX_ROWS).map((cols) => {
    const row = emptyRow();
    cols.forEach((rawVal, colIdx) => {
      if (colIdx >= PASTE_FIELD_ORDER.length) return;
      const field = PASTE_FIELD_ORDER[colIdx];
      row[field] = normalizePastedValue(field, rawVal ?? "");
    });
    return row;
  });
}

function parseGridText(text: string): RowData[] {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];
  const lines = trimmed.split("\n");
  const isTabbed = trimmed.includes("\t");
  const matrix = lines.map((line) =>
    isTabbed ? line.split("\t") : splitCsvLine(line),
  );
  return rowsFromMatrix(matrix);
}

// Minimal RFC4180-ish CSV line splitter — handles quoted fields with commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else if (c === '"' && cur === "") {
      inQuotes = true;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function parseFileToRows(file: File): Promise<RowData[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = wb.Sheets[firstSheet];
  // raw:false → force string output, handles dates and numbers consistently.
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return rowsFromMatrix(matrix.map((r) => r.map((c) => String(c ?? ""))));
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, TEMPLATE_SAMPLE]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clients");
  XLSX.writeFile(wb, "client-import-template.xlsx");
}

// ─── Component ────────────────────────────────────────────────────────────────

interface BulkClientImportProps {
  open: boolean;
  onClose: () => void;
}

const timeInputClass = (error?: boolean) =>
  `h-7 w-28 rounded border px-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring ${
    error ? "border-red-400" : "border-input"
  }`;

export function BulkClientImport({ open, onClose }: BulkClientImportProps) {
  const router = useRouter();
  const [rows, setRows] = useState<RowData[]>([emptyRow()]);
  const [errors, setErrors] = useState<Record<number, RowErrors>>({});
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [rowAvailability, setRowAvailability] = useState<Record<number, RowAvailability>>({});
  const [availErrors, setAvailErrors] = useState<Record<number, Partial<Record<DayKey, string>>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [importResult, setImportResult] = useState<{
    successes: number;
    failures: { index: number; error: string }[];
  } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ingestParsedRows = useCallback((parsed: RowData[]) => {
    if (parsed.length === 0) {
      setImportNotice("No rows found.");
      return;
    }
    setRows(parsed);
    setRowAvailability({});
    setErrors({});
    setAvailErrors({});
    setExpandedRows(new Set());
    setImportResult(null);
    const truncated = parsed.length === MAX_ROWS ? ` (capped at ${MAX_ROWS})` : "";
    setImportNotice(`Loaded ${parsed.length} row${parsed.length === 1 ? "" : "s"}${truncated}. Review and submit.`);
  }, []);

  const handlePasteSubmit = useCallback(() => {
    const parsed = parseGridText(pasteText);
    setPasteOpen(false);
    setPasteText("");
    ingestParsedRows(parsed);
  }, [pasteText, ingestParsedRows]);

  const handleFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const parsed = await parseFileToRows(file);
        ingestParsedRows(parsed);
      } catch (err) {
        setImportNotice(
          err instanceof Error
            ? `Couldn't read file: ${err.message}`
            : "Couldn't read file.",
        );
      }
    },
    [ingestParsedRows],
  );

  const updateCell = useCallback((rowIndex: number, key: keyof RowData, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r)));
    setErrors((prev) => {
      if (!prev[rowIndex]?.[key]) return prev;
      const rowErrors = { ...prev[rowIndex] };
      delete rowErrors[key];
      return { ...prev, [rowIndex]: rowErrors };
    });
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => (prev.length < MAX_ROWS ? [...prev, emptyRow()] : prev));
  }, []);

  const deleteRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const next: Record<number, RowErrors> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < index) next[ki] = v;
        else if (ki > index) next[ki - 1] = v;
      });
      return next;
    });
    setExpandedRows((prev) => {
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx < index) next.add(idx);
        else if (idx > index) next.add(idx - 1);
      });
      return next;
    });
    setRowAvailability((prev) => {
      const next: Record<number, RowAvailability> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < index) next[ki] = v;
        else if (ki > index) next[ki - 1] = v;
      });
      return next;
    });
    setAvailErrors((prev) => {
      const next: typeof prev = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < index) next[ki] = v;
        else if (ki > index) next[ki - 1] = v;
      });
      return next;
    });
  }, []);

  const toggleRow = useCallback((rowIndex: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }, []);

  const toggleDay = useCallback((rowIndex: number, dayKey: DayKey) => {
    setRowAvailability((prev) => {
      const rowAvail = { ...(prev[rowIndex] || {}) };
      if (rowAvail[dayKey]) {
        delete rowAvail[dayKey];
      } else {
        rowAvail[dayKey] = { startTime: "", endTime: "" };
      }
      return { ...prev, [rowIndex]: rowAvail };
    });
    setAvailErrors((prev) => {
      if (!prev[rowIndex]?.[dayKey]) return prev;
      const rowE = { ...prev[rowIndex] };
      delete rowE[dayKey];
      return { ...prev, [rowIndex]: rowE };
    });
  }, []);

  const updateDayTime = useCallback(
    (rowIndex: number, dayKey: DayKey, field: "startTime" | "endTime", value: string) => {
      setRowAvailability((prev) => {
        const rowAvail = { ...(prev[rowIndex] || {}) };
        rowAvail[dayKey] = { ...(rowAvail[dayKey] || { startTime: "", endTime: "" }), [field]: value };
        return { ...prev, [rowIndex]: rowAvail };
      });
      setAvailErrors((prev) => {
        if (!prev[rowIndex]?.[dayKey]) return prev;
        const rowE = { ...prev[rowIndex] };
        delete rowE[dayKey];
        return { ...prev, [rowIndex]: rowE };
      });
    },
    []
  );

  const handlePaste = useCallback(
    (rowIndex: number, e: React.ClipboardEvent<HTMLElement>) => {
      const text = e.clipboardData.getData("text/plain");
      if (!text.includes("\t")) return;
      e.preventDefault();
      const pastedRows = text.trim().split(/\r?\n/).map((line) => line.split("\t"));
      setRows((prev) => {
        const next = [...prev];
        pastedRows.forEach((cols, offset) => {
          const targetIndex = rowIndex + offset;
          if (targetIndex >= MAX_ROWS) return;
          while (next.length <= targetIndex) next.push(emptyRow());
          const row: RowData = { ...next[targetIndex] };
          cols.forEach((rawVal, colIdx) => {
            if (colIdx >= PASTE_FIELD_ORDER.length) return;
            const field = PASTE_FIELD_ORDER[colIdx];
            row[field] = normalizePastedValue(field, rawVal);
          });
          next[targetIndex] = row;
        });
        return next;
      });
    },
    []
  );

  const validate = useCallback((): boolean => {
    const newErrors: Record<number, RowErrors> = {};
    const newAvailErrors: Record<number, Partial<Record<DayKey, string>>> = {};
    const seenIds = new Map<string, number>();

    rows.forEach((row, i) => {
      const rowErrors: RowErrors = {};

      if (!row.firstName.trim()) rowErrors.firstName = "Required";
      if (!row.lastName.trim()) rowErrors.lastName = "Required";
      if (!row.externalId.trim()) {
        rowErrors.externalId = "Required";
      } else if (seenIds.has(row.externalId.trim())) {
        const priorIndex = seenIds.get(row.externalId.trim())!;
        rowErrors.externalId = `Duplicate of row ${priorIndex + 1}`;
        if (!newErrors[priorIndex]) newErrors[priorIndex] = {};
        newErrors[priorIndex].externalId = `Duplicate of row ${i + 1}`;
      } else {
        seenIds.set(row.externalId.trim(), i);
      }
      if (!row.dateOfBirth) rowErrors.dateOfBirth = "Required";
      if (!row.gender) rowErrors.gender = "Required";
      if (!row.insurance.trim()) rowErrors.insurance = "Required";
      if (!row.activeDate) rowErrors.activeDate = "Required";
      if (row.defaultSessionHours) {
        const h = parseFloat(row.defaultSessionHours);
        if (isNaN(h) || h < 2 || h > 8) rowErrors.defaultSessionHours = "Must be 2–8";
      }

      if (Object.keys(rowErrors).length > 0) newErrors[i] = rowErrors;

      // Validate availability windows
      const rowAvail = rowAvailability[i] || {};
      const dayErrors: Partial<Record<DayKey, string>> = {};
      for (const [dayKey, w] of Object.entries(rowAvail)) {
        if (!w.startTime || !w.endTime) {
          dayErrors[dayKey as DayKey] = "Both times required";
        } else if (w.startTime >= w.endTime) {
          dayErrors[dayKey as DayKey] = "End must be after start";
        }
      }
      if (Object.keys(dayErrors).length > 0) {
        newAvailErrors[i] = dayErrors;
        // Expand the row so the user can see the errors
        setExpandedRows((prev) => new Set([...prev, i]));
      }
    });

    setErrors(newErrors);
    setAvailErrors(newAvailErrors);
    return Object.keys(newErrors).length === 0 && Object.keys(newAvailErrors).length === 0;
  }, [rows, rowAvailability]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;

    setSubmitting(true);
    setImportResult(null);

    const inputs = rows.map((row, i) => ({
      firstName: row.firstName.trim(),
      lastName: row.lastName.trim(),
      externalId: row.externalId.trim(),
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      spanish: row.spanish === "yes",
      femaleProviderOnly: row.femaleProviderOnly === "yes",
      insurance: row.insurance.trim(),
      activeDate: row.activeDate,
      preferredLocation: row.preferredLocation as "HOME" | "CENTER" | "HYBRID" | "SCHOOL",
      minimumRbtLevel: (row.minimumRbtLevel as "I" | "II" | "III") || null,
      defaultSessionHours: row.defaultSessionHours ? parseFloat(row.defaultSessionHours) : null,
      availability: rowAvailability[i] || {},
    }));

    let res: Awaited<ReturnType<typeof createClientsInBulk>>;
    try {
      res = await createClientsInBulk(inputs);
    } catch {
      setSubmitting(false);
      setImportNotice("Import failed - please try again.");
      return;
    }
    setSubmitting(false);

    if (!res.success) {
      // Top-level failure (auth, row cap, ...) - show it instead of silently returning
      setImportNotice(res.error);
      return;
    }

    setImportResult(res.data);

    if (res.data.failures.length === 0) {
      router.refresh();
      handleClose();
      return;
    }

    // Some rows imported - refresh the list so successes show up immediately,
    // and keep the dialog open so the failed rows can be corrected.
    if (res.data.successes > 0) {
      router.refresh();
    }

    const serverErrors: Record<number, RowErrors> = {};
    res.data.failures.forEach(({ index, error }) => {
      serverErrors[index] = { externalId: error };
    });
    setErrors(serverErrors);
  }, [rows, rowAvailability, validate, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    setRows([emptyRow()]);
    setErrors({});
    setExpandedRows(new Set());
    setRowAvailability({});
    setAvailErrors({});
    setImportResult(null);
    onClose();
  }, [onClose]);

  const errorRowCount = Object.values(errors).filter(
    (e) => e && Object.keys(e).length > 0
  ).length + Object.values(availErrors).filter(
    (e) => e && Object.keys(e).length > 0
  ).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="schedule-warm max-w-[98vw] sm:max-w-[98vw] w-full h-[92vh] flex flex-col p-0 gap-0 bg-background"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <DialogTitle>Import Multiple Clients</DialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Paste a spreadsheet block, import an .xlsx / .csv file, or fill rows by hand.
                Address and additional availability can be added on the client profile after import.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Column order:{" "}
                <span className="font-mono">{TEMPLATE_HEADERS.join(" · ")}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="button" variant="outline" size="sm" onClick={() => setPasteOpen(true)}>
                <ClipboardPaste size={14} className="mr-1.5" />
                Paste data
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileSpreadsheet size={14} className="mr-1.5" />
                Import file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFilePicked}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={downloadTemplate}
                title="Download a blank template with the right column order"
              >
                <Download size={14} className="mr-1.5" />
                Template
              </Button>
            </div>
          </div>
          {importNotice && (
            <p className="text-xs text-primary mt-2" role="status">
              {importNotice}
            </p>
          )}
        </DialogHeader>

        {/* Spreadsheet table */}
        <div className="flex-1 overflow-auto px-6 py-4 min-h-0">
          <table
            className="border-collapse text-sm"
            style={{ tableLayout: "fixed", minWidth: "1320px", width: "100%" }}
          >
            <colgroup>
              <col style={{ width: "36px" }} />
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: col.width }} />
              ))}
              <col style={{ width: "130px" }} />
              <col style={{ width: "36px" }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/60">
                <th className="py-2 text-left text-xs font-medium text-muted-foreground">#</th>
                {COLUMNS.map((col) => (
                  <th key={col.key} className="py-2 px-1 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                    {col.header}
                  </th>
                ))}
                <th className="py-2 px-1 text-left text-xs font-medium text-muted-foreground">Availability</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const hasError = errors[rowIndex] && Object.keys(errors[rowIndex]).length > 0;
                const hasAvailError = availErrors[rowIndex] && Object.keys(availErrors[rowIndex]).length > 0;
                const isExpanded = expandedRows.has(rowIndex);
                const rowAvail = rowAvailability[rowIndex] || {};
                const daysSet = Object.keys(rowAvail).length;

                return (
                  <>
                    <tr
                      key={rowIndex}
                      className={
                        hasError || hasAvailError
                          ? "bg-red-50/40"
                          : rowIndex % 2 === 1
                            ? "bg-muted/20"
                            : undefined
                      }
                    >
                      <td className="py-1.5 text-xs text-muted-foreground pr-2 text-right">
                        {rowIndex + 1}
                      </td>
                      {COLUMNS.map((col) => (
                        <td key={col.key} className="py-1.5 px-1">
                          {col.renderCell({
                            value: row[col.key],
                            onChange: (val) => updateCell(rowIndex, col.key, val),
                            onPaste: (e) => handlePaste(rowIndex, e),
                            error: errors[rowIndex]?.[col.key],
                          })}
                        </td>
                      ))}
                      <td className="py-1.5 px-1">
                        <button
                          type="button"
                          onClick={() => toggleRow(rowIndex)}
                          className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 border transition-colors ${
                            hasAvailError
                              ? "border-red-400 text-red-600 bg-red-50"
                              : daysSet > 0
                                ? "border-green-300 text-green-700 bg-green-50 hover:bg-green-100"
                                : "border-input text-muted-foreground hover:bg-muted/40"
                          }`}
                        >
                          {isExpanded ? (
                            <ChevronUp size={12} />
                          ) : (
                            <CalendarDays size={12} />
                          )}
                          {hasAvailError
                            ? "Fix times"
                            : daysSet > 0
                              ? `${daysSet} day${daysSet !== 1 ? "s" : ""}`
                              : "Add"}
                        </button>
                      </td>
                      <td className="py-1.5 pl-1">
                        <button
                          type="button"
                          onClick={() => deleteRow(rowIndex)}
                          className="p-1 text-muted-foreground hover:text-red-500 rounded transition-colors"
                          title="Remove row"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${rowIndex}-avail`} className="border-b border-border">
                        <td
                          colSpan={99}
                          className={`px-10 pt-2 pb-4 ${
                            rowIndex % 2 === 1 ? "bg-muted/20" : "bg-background"
                          }`}
                        >
                          <p className="text-xs font-medium text-muted-foreground mb-2">
                            Weekly Availability — check a day to set a time window
                          </p>
                          <div className="space-y-1.5 max-w-md">
                            {DAYS.map((day) => {
                              const dayAvail = rowAvail[day.key];
                              const enabled = !!dayAvail;
                              const dayError = availErrors[rowIndex]?.[day.key];
                              return (
                                <div key={day.key} className="flex items-center gap-3">
                                  <label className="flex items-center gap-2 w-28 cursor-pointer shrink-0">
                                    <input
                                      type="checkbox"
                                      checked={enabled}
                                      onChange={() => toggleDay(rowIndex, day.key)}
                                      className="rounded"
                                    />
                                    <span className={`text-sm ${enabled ? "text-foreground" : "text-muted-foreground"}`}>
                                      {day.label}
                                    </span>
                                  </label>
                                  {enabled && (
                                    <>
                                      <input
                                        type="time"
                                        value={dayAvail.startTime}
                                        onChange={(e) => updateDayTime(rowIndex, day.key, "startTime", e.target.value)}
                                        className={timeInputClass(!dayAvail.startTime && !!dayError)}
                                      />
                                      <span className="text-muted-foreground text-sm shrink-0">—</span>
                                      <input
                                        type="time"
                                        value={dayAvail.endTime}
                                        onChange={(e) => updateDayTime(rowIndex, day.key, "endTime", e.target.value)}
                                        className={timeInputClass(!!dayError && (!dayAvail.endTime || dayAvail.startTime >= dayAvail.endTime))}
                                      />
                                      {dayError && (
                                        <span className="text-xs text-red-500">{dayError}</span>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>

          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= MAX_ROWS}
            className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <Plus size={14} />
            Add row{rows.length >= MAX_ROWS ? " (50 row limit reached)" : ""}
          </button>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/40 shrink-0 sm:justify-between items-center -mx-0 -mb-0 rounded-b-xl">
          <div className="text-sm text-muted-foreground">
            {rows.length} row{rows.length !== 1 ? "s" : ""}
            {errorRowCount > 0 && (
              <span className="ml-2 text-red-600 font-medium">
                · {errorRowCount} row{errorRowCount !== 1 ? "s have" : " has"} errors
              </span>
            )}
            {importResult && importResult.failures.length > 0 && (
              <span className="ml-2 text-amber-600 font-medium">
                · {importResult.successes} imported, {importResult.failures.length} failed
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? "Importing…"
                : `Import ${rows.length} Client${rows.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* ── Paste-anywhere sub-dialog ───────────────────────────────────── */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Paste spreadsheet data</DialogTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Copy a block of cells from Excel, Google Sheets, or Numbers and paste below.
              The first row may be a header row — it&apos;s skipped automatically. Existing rows in the grid will be replaced.
            </p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {TEMPLATE_HEADERS.join(" · ")}
            </p>
          </DialogHeader>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste here (Cmd+V / Ctrl+V)…"
            className="min-h-[280px] w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <DialogFooter className="sm:justify-end gap-2">
            <Button variant="outline" onClick={() => { setPasteOpen(false); setPasteText(""); }}>
              Cancel
            </Button>
            <Button onClick={handlePasteSubmit} disabled={!pasteText.trim()}>
              Load into grid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
