import { useState, useRef } from "react";
import { API } from "../../lib/api";

export const ALLOWED_EXTS = [".csv",".json",".jsonl",".xlsx",".xls",".txt",".tsv",".parquet",".xml"];

export interface UploadedFile {
  name: string;
  size: number;
  [key: string]: unknown;
}

interface FileUploadZoneProps {
  files: UploadedFile[];
  onAdd: (file: UploadedFile) => void;
  onRemove: (name: string) => void;
  /** Session hiện tại — gửi kèm upload để file vào sandbox riêng của phiên,
   *  không dùng thư mục chung (tránh hai phiên đè file trùng tên lên nhau). */
  sessionId: string;
}

export function FileUploadZone({ files, onAdd, onRemove, sessionId }: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const uploadFile = async (file: File) => {
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      alert(`Không hỗ trợ định dạng ${ext}. Chỉ chấp nhận: ${ALLOWED_EXTS.join(", ")}`);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("session_id", sessionId);
      const res = await fetch(`${API}/api/coding/upload`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Upload thất bại");
      }
      const data: UploadedFile = await res.json();
      onAdd(data);
    } catch (e) {
      alert("Upload lỗi: " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = (fileList: FileList) => {
    Array.from(fileList).forEach(uploadFile);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="upload-zone-wrap">
      <div
        className={`upload-drop ${dragging ? "upload-drop-active" : ""}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" multiple hidden
          accept={ALLOWED_EXTS.join(",")}
          onChange={e => e.target.files && handleFiles(e.target.files)} />
        {uploading
          ? <span className="upload-hint"><span className="mini-spinner" /> Đang upload...</span>
          : <span className="upload-hint">
              <span className="upload-icon">📂</span>
              Kéo thả file hoặc <span className="upload-link">chọn file</span>
              <span className="upload-types">{ALLOWED_EXTS.join(" ")}</span>
            </span>
        }
      </div>

      {files.length > 0 && (
        <div className="upload-file-list">
          {files.map(f => (
            <div key={f.name} className="upload-file-item">
              <span className="upload-file-icon">{f.name.endsWith(".csv") ? "📊" : f.name.endsWith(".json") || f.name.endsWith(".jsonl") ? "📋" : f.name.endsWith(".xlsx") || f.name.endsWith(".xls") ? "📈" : "📄"}</span>
              <span className="upload-file-name">{f.name}</span>
              <span className="upload-file-size">{(f.size / 1024).toFixed(1)}KB</span>
              <button className="upload-file-del" onClick={() => onRemove(f.name)} title="Xóa">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

//Drag resize
