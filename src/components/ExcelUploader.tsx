"use client";

import { useState, useCallback, useRef } from "react";
import { parsePaymentExcel, type PaymentRow } from "@/lib/parsePaymentExcel";

interface Props {
  onParsed: (rows: PaymentRow[], fileName: string) => void;
}

export default function ExcelUploader({ onParsed }: Props) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      const buffer = await file.arrayBuffer();
      const rows = parsePaymentExcel(buffer);
      onParsed(rows, file.name);
    },
    [onParsed]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded border-2 border-dashed p-8 text-center transition-colors ${
        dragging
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
          : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-zinc-600"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileSelect}
        className="hidden"
      />
      <div className="text-3xl mb-2">📂</div>
      {fileName ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium">{fileName}</span> 로드 완료
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            수납내역 엑셀 파일을 여기에 드래그하거나 클릭하여 선택
          </p>
          <p className="text-xs text-zinc-400 mt-1">.xlsx, .xls 지원</p>
        </>
      )}
    </div>
  );
}
