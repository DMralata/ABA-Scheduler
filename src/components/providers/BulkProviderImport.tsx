"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, CalendarDays, ChevronUp } from "lucide-react";
import { createProvidersInBulk } from "@/lib/actions/providers";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RowData {
  firstName: string;
  lastName: string;
  externalId: string;
  gender: string;
  spanish: string;
  position: string;
  rbtLevel: string;
  payRateHourly: string;
}

type RowErrors = Partial<Record<keyof RowData, string>>;

interface AvailWindow {
  startTime: string;
  endTime: string;
}

type RowAvailability = Record<string, AvailWindow>;

const emptyRow = (): RowData => ({
  firstName: "",
  lastName: "",
  externalId: "",
  gender: "",
  spanish: "no",
  position: "",
  rbtLevel: "",
  payRateHourly: "",
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
  rowData: RowData;
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
    width: "130px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="First" title={error} />
    ),
  },
  {
    key: "lastName",
    header: "Last Name *",
    width: "130px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="Last" title={error} />
    ),
  },
  {
    key: "externalId",
    header: "External ID *",
    width: "120px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="EMR ID" title={error} />
    ),
  },
  {
    key: "gender",
    header: "Gender *",
    width: "110px",
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
    width: "100px",
    renderCell: ({ value, onChange, onPaste }) => (
      <select className={selectClass()} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste}>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    ),
  },
  {
    key: "position",
    header: "Position *",
    width: "120px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <select className={selectClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} title={error}>
        <option value="">—</option>
        <option value="BCBA">BCBA</option>
        <option value="BCaBA">BCaBA</option>
        <option value="RBT">RBT</option>
      </select>
    ),
  },
  {
    key: "rbtLevel",
    header: "RBT Level",
    width: "120px",
    renderCell: ({ value, rowData, onChange, onPaste, error }) => {
      const isRbt = rowData.position === "RBT";
      return (
        <select
          className={selectClass(error)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          disabled={!isRbt}
          title={!isRbt ? "Only applies to RBT position" : error}
        >
          <option value="">{isRbt ? "— Required" : "N/A"}</option>
          <option value="I">Level I</option>
          <option value="II">Level II</option>
          <option value="III">Level III</option>
        </select>
      );
    },
  },
  {
    key: "payRateHourly",
    header: "Pay Rate/Hr",
    width: "110px",
    renderCell: ({ value, onChange, onPaste, error }) => (
      <input type="number" className={inputClass(error)} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder="—" min={0} step={0.01} title={error} />
    ),
  },
];

// ─── Paste parser ─────────────────────────────────────────────────────────────

const PASTE_FIELD_ORDER: (keyof RowData)[] = [
  "firstName", "lastName", "externalId", "gender",
  "spanish", "position", "rbtLevel", "payRateHourly",
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
    case "spanish": {
      const l = v.toLowerCase();
      return l === "yes" || l === "true" || l === "1" ? "yes" : "no";
    }
    case "position": {
      const l = v.toLowerCase();
      if (l === "bcba") return "BCBA";
      if (l === "bcaba") return "BCaBA";
      if (l === "rbt") return "RBT";
      return v.toUpperCase();
    }
    case "rbtLevel": {
      const l = v.toLowerCase().trim();
      if (!l || l === "none" || l === "n/a") return "";
      if (l === "i" || l === "1" || l.includes("level i")) return "I";
      if (l === "ii" || l === "2" || l.includes("level ii")) return "II";
      if (l === "iii" || l === "3" || l.includes("level iii")) return "III";
      return "";
    }
    default:
      return v;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface BulkProviderImportProps {
  open: boolean;
  onClose: () => void;
}

const timeInputClass = (error?: boolean) =>
  `h-7 w-28 rounded border px-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring ${
    error ? "border-red-400" : "border-input"
  }`;

export function BulkProviderImport({ open, onClose }: BulkProviderImportProps) {
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
      if (!row.gender) rowErrors.gender = "Required";
      if (!row.position) {
        rowErrors.position = "Required";
      } else if (row.position === "RBT" && !row.rbtLevel) {
        rowErrors.rbtLevel = "Required for RBT";
      }
      if (row.payRateHourly) {
        const r = parseFloat(row.payRateHourly);
        if (isNaN(r) || r <= 0) rowErrors.payRateHourly = "Must be > 0";
      }

      if (Object.keys(rowErrors).length > 0) newErrors[i] = rowErrors;

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
      gender: row.gender,
      spanish: row.spanish === "yes",
      position: row.position as "BCBA" | "BCaBA" | "RBT",
      rbtLevel: (row.rbtLevel as "I" | "II" | "III") || null,
      payRateHourly: row.payRateHourly ? parseFloat(row.payRateHourly) : null,
      availability: rowAvailability[i] || {},
    }));

    const res = await createProvidersInBulk(inputs);
    setSubmitting(false);

    if (!res.success) return;

    setImportResult(res.data);

    if (res.data.failures.length === 0) {
      router.refresh();
      handleClose();
      return;
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

  const errorRowCount =
    Object.values(errors).filter((e) => e && Object.keys(e).length > 0).length +
    Object.values(availErrors).filter((e) => e && Object.keys(e).length > 0).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="schedule-warm max-w-[98vw] sm:max-w-[98vw] w-full h-[92vh] flex flex-col p-0 gap-0 bg-background"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle>Import Multiple Providers</DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fill each row or paste directly from Excel / Google Sheets (Tab-delimited).
            Address and additional availability can be added on the provider profile after import.
          </p>
          <p className="text-xs text-muted-foreground">
            Column order for paste:{" "}
            <span className="font-mono">
              First Name · Last Name · External ID · Gender · Spanish · Position · RBT Level · Pay Rate
            </span>
          </p>
        </DialogHeader>

        {/* Spreadsheet table */}
        <div className="flex-1 overflow-auto px-6 py-4 min-h-0">
          <table
            className="border-collapse text-sm"
            style={{ tableLayout: "fixed", minWidth: "1060px", width: "100%" }}
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
                            rowData: row,
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
                          {isExpanded ? <ChevronUp size={12} /> : <CalendarDays size={12} />}
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
                : `Import ${rows.length} Provider${rows.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
