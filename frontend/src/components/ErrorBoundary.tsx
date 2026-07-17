import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Nhãn khu vực để thông báo lỗi cụ thể hơn ("Research", "Coding"…). */
  label?: string;
}
interface State {
  error: Error | null;
}

/** Chặn crash lan ra toàn app.
 *
 *  React chỉ gỡ lỗi render bằng class component (chưa có hook tương đương):
 *  một lỗi ném ra trong lúc render con sẽ được getDerivedStateFromError bắt
 *  lại, thay vì unmount cả cây trên nó và để lại màn hình trắng. Mỗi route
 *  được bọc một boundary riêng (xem App.tsx) nên lỗi ở /research không giết
 *  /chat — điều hướng vẫn sống, người dùng bấm sang trang khác được.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Giữ lại trace trong console để còn debug được; production có thể nối
    // vào một dịch vụ log ở đây.
    console.error("ErrorBoundary bắt được lỗi:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    const { label } = this.props;
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          minHeight: "60vh",
          padding: 24,
          textAlign: "center",
          fontFamily: "var(--sans)",
          color: "var(--text)",
        }}
      >
        <div style={{ fontSize: 32, lineHeight: 1 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>
          {label ? `Phần "${label}" gặp sự cố` : "Đã có lỗi xảy ra"}
        </div>
        <p style={{ fontSize: 13, color: "var(--text2)", maxWidth: 340, lineHeight: 1.5, margin: 0 }}>
          Một lỗi ngoài dự kiến khiến khu vực này không hiển thị được. Các phần
          khác của ứng dụng vẫn hoạt động bình thường.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={this.reset}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: "1px solid var(--border2)",
              background: "var(--accent)",
              color: "#000",
              fontFamily: "var(--sans)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Thử lại
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: "1px solid var(--border2)",
              background: "var(--bg3)",
              color: "var(--text2)",
              fontFamily: "var(--sans)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Tải lại trang
          </button>
        </div>
      </div>
    );
  }
}
