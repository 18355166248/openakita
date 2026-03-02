import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  IconKey,
  IconClipboard,
  IconCheck,
  IconRefresh,
  IconX,
} from "../icons";

// ── 类型定义 ──

type AuthKeyData = {
  key: string;
  opsId: string;
  createdAt: number;
};

type LoginStatus = "idle" | "pending" | "success" | "error";

type Order = {
  orderId: string;
  orderStatus: string;
  displayStatus: string;
  productName: string;
  amount: number;
  createdAt: string;
  [key: string]: unknown;
};

type OrderFetchStatus = "idle" | "loading" | "success" | "error";

// ── 工具函数 ──

async function generateKeyFromOpsId(opsId: string): Promise<string> {
  const raw = `${opsId}::${Date.now()}::${Math.random().toString(36).slice(2)}`;
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  // 格式化为 xxxx-xxxx-xxxx-xxxx 风格，前缀 ops- 标识来源
  return `ops-${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}-${hex.slice(24, 32)}`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString("zh-CN");
}

// ── 主组件 ──

type Props = {
  visible?: boolean;
};

export function AuthKeyView({ visible = true }: Props) {
  const [loginStatus, setLoginStatus] = useState<LoginStatus>("idle");
  const [authKey, setAuthKey] = useState<string | null>(null);
  const [opsId, setOpsId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const [orderFetchStatus, setOrderFetchStatus] = useState<OrderFetchStatus>("idle");
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderError, setOrderError] = useState<string | null>(null);

  // 加载已保存的 key
  useEffect(() => {
    invoke<AuthKeyData | null>("get_auth_key")
      .then((data) => {
        if (data) {
          setAuthKey(data.key);
          setOpsId(data.opsId);
          setCreatedAt(data.createdAt);
          setLoginStatus("success");
        }
      })
      .catch(() => {});
  }, []);

  // 监听 CAS 登录结果事件
  useEffect(() => {
    let active = true;

    listen<string>("cas_login_result", async (event) => {
      if (!active) return;
      const receivedOpsId = event.payload;

      if (!receivedOpsId) {
        setLoginStatus("error");
        setErrorMsg("登录成功但未能获取 opsId，请检查 /getOpsId 接口是否可用");
        return;
      }

      try {
        const key = await generateKeyFromOpsId(receivedOpsId);
        await invoke("save_auth_key", { key, opsId: receivedOpsId });

        const now = Math.floor(Date.now() / 1000);
        setAuthKey(key);
        setOpsId(receivedOpsId);
        setCreatedAt(now);
        setLoginStatus("success");
        setErrorMsg(null);
      } catch (e) {
        setLoginStatus("error");
        setErrorMsg(`生成 Key 失败: ${e}`);
      }
    })
      .then((unlisten) => {
        unlistenRef.current = unlisten;
      })
      .catch(() => {});

    return () => {
      active = false;
      unlistenRef.current?.();
    };
  }, []);

  const handleOpenLogin = useCallback(async () => {
    setLoginStatus("pending");
    setErrorMsg(null);
    try {
      await invoke("open_cas_login_window");
    } catch (e) {
      setLoginStatus("error");
      setErrorMsg(`打开登录窗口失败: ${e}`);
    }
  }, []);

  const handleCopy = useCallback(() => {
    if (!authKey) return;
    navigator.clipboard
      .writeText(authKey)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }, [authKey]);

  const handleReset = useCallback(async () => {
    try {
      await invoke("save_auth_key", { key: "", opsId: "" });
    } catch {
      /* ignore */
    }
    setAuthKey(null);
    setOpsId(null);
    setCreatedAt(null);
    setLoginStatus("idle");
    setErrorMsg(null);
  }, []);

  const handleFetchOrders = useCallback(async () => {
    if (!opsId) return;
    setOrderFetchStatus("loading");
    setOrderError(null);
    setOrders([]);

    try {
      // 通过 Tauri 后端代理请求，避免浏览器跨域限制
      const raw = await invoke<string>("http_proxy_request", {
        url: `https://m.ximalaya.com/test`,
        method: "GET",
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          // opsId 作为查询身份的标识附加到 Cookie 中
          cookie: `xm-ops-id=${opsId}`,
        },
        timeoutSecs: 15,
      });

      const result = JSON.parse(raw) as { status: number; body: string };
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`接口返回异常状态码：${result.status}`);
      }

      const data = JSON.parse(result.body) as {
        ret?: number;
        data?: { list?: Order[] };
        [key: string]: unknown;
      };

      const list: Order[] = data?.data?.list ?? [];
      setOrders(list);
      setOrderFetchStatus("success");
    } catch (e) {
      setOrderError(`获取订单失败：${e}`);
      setOrderFetchStatus("error");
    }
  }, [opsId]);

  if (!visible) return null;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 680, margin: "0 auto" }}>
      {/* 标题 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <IconKey size={20} color="var(--brand, #3b82f6)" />
        <h2
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          身份认证 Key
        </h2>
      </div>
      <p
        style={{
          margin: "0 0 24px",
          fontSize: 13,
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        通过 CAS 统一认证登录，系统将基于你的 opsId 生成唯一身份 Key。 复制该
        Key 并粘贴到需要身份标识的位置，后续请求将携带此 Key 进行身份验证。
      </p>

      {/* 登录操作区 */}
      {loginStatus !== "success" && (
        <div
          className="card"
          style={{ marginBottom: 20, padding: "20px 24px" }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              marginBottom: 12,
              color: "var(--text)",
            }}
          >
            第一步：CAS 统一认证登录
          </div>
          <p
            style={{
              fontSize: 13,
              color: "var(--muted)",
              margin: "0 0 16px",
              lineHeight: 1.6,
            }}
          >
            点击下方按钮，将在新窗口打开 CAS
            登录页面。登录成功后系统将自动检测并获取你的 opsId，
            随后生成唯一身份 Key。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="btnPrimary"
              onClick={handleOpenLogin}
              disabled={loginStatus === "pending"}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <IconKey size={14} />
              {loginStatus === "pending" ? "等待登录中…" : "打开 CAS 登录"}
            </button>
            {loginStatus === "pending" && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    border: "2px solid var(--brand, #3b82f6)",
                    borderTopColor: "transparent",
                    display: "inline-block",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                登录窗口已打开，请在窗口中完成登录…
              </span>
            )}
          </div>

          {loginStatus === "error" && errorMsg && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                color: "#ef4444",
                fontSize: 12,
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
              }}
            >
              <IconX size={13} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      )}

      {/* 已生成的 Key 展示区 */}
      {loginStatus === "success" && authKey && (
        <>
          <div
            className="card"
            style={{ marginBottom: 16, padding: "20px 24px" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--text)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <IconCheck size={14} color="#22c55e" />
                身份 Key 已生成
              </div>
              <button
                className="btnSmall"
                onClick={handleReset}
                style={{
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="重新登录并生成新 Key"
              >
                <IconRefresh size={12} />
                重新生成
              </button>
            </div>

            {/* Key 展示 */}
            <div style={{ marginBottom: 12 }}>
              <div
                style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}
              >
                身份 Key
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--nav-hover, rgba(0,0,0,0.04))",
                  borderRadius: 8,
                  padding: "10px 14px",
                  border: "1px solid var(--line, rgba(0,0,0,0.1))",
                }}
              >
                <code
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontFamily: "monospace",
                    color: "var(--text)",
                    wordBreak: "break-all",
                    lineHeight: 1.4,
                  }}
                >
                  {authKey}
                </code>
                <button
                  onClick={handleCopy}
                  style={{
                    flexShrink: 0,
                    background: copied
                      ? "rgba(34,197,94,0.1)"
                      : "var(--card-bg, #fff)",
                    border: `1px solid ${copied ? "#22c55e" : "var(--line, rgba(0,0,0,0.1))"}`,
                    borderRadius: 6,
                    padding: "6px 10px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    color: copied ? "#22c55e" : "var(--text)",
                    transition: "all 0.15s",
                  }}
                >
                  {copied ? (
                    <IconCheck size={13} />
                  ) : (
                    <IconClipboard size={13} />
                  )}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>

            {/* opsId 信息 */}
            {opsId && (
              <div style={{ marginBottom: 8 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  opsId
                </div>
                <code
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    background: "var(--nav-hover, rgba(0,0,0,0.04))",
                    borderRadius: 4,
                    padding: "2px 8px",
                  }}
                >
                  {opsId}
                </code>
              </div>
            )}

            {createdAt && (
              <div
                style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}
              >
                生成时间：{formatTimestamp(createdAt)}
              </div>
            )}
          </div>

          {/* 使用引导 */}
          <div
            style={{
              padding: "14px 18px",
              borderRadius: 8,
              background: "rgba(59,130,246,0.06)",
              border: "1px solid rgba(59,130,246,0.18)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--brand, #3b82f6)",
                marginBottom: 8,
              }}
            >
              📋 使用方法
            </div>
            <ol
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 13,
                color: "var(--text)",
                lineHeight: 2,
              }}
            >
              <li>点击上方「复制」按钮复制身份 Key</li>
              <li>将 Key 粘贴到对应的身份标识输入框中</li>
              <li>后续 API 请求将自动携带此 Key 作为身份凭证</li>
            </ol>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
              Key 格式：
              <code
                style={{
                  fontSize: 11,
                  background: "var(--nav-hover)",
                  padding: "1px 6px",
                  borderRadius: 3,
                }}
              >
                ops-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx
              </code>
            </div>
          </div>

          {/* 订单查询区 */}
          <div
            className="card"
            style={{ marginTop: 16, padding: "20px 24px" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--text)",
                }}
              >
                订单数据查询
              </div>
              <button
                className="btnPrimary"
                onClick={handleFetchOrders}
                disabled={orderFetchStatus === "loading"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  padding: "6px 14px",
                }}
              >
                {orderFetchStatus === "loading" ? (
                  <>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        border: "2px solid rgba(255,255,255,0.4)",
                        borderTopColor: "#fff",
                        display: "inline-block",
                        animation: "spin 0.8s linear infinite",
                      }}
                    />
                    获取中…
                  </>
                ) : (
                  <>
                    <IconRefresh size={12} />
                    获取订单数据
                  </>
                )}
              </button>
            </div>

            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                marginBottom: 12,
                lineHeight: 1.6,
              }}
            >
              基于当前 opsId（
              <code
                style={{
                  fontSize: 11,
                  background: "var(--nav-hover, rgba(0,0,0,0.04))",
                  padding: "1px 5px",
                  borderRadius: 3,
                }}
              >
                {opsId}
              </code>
              ）通过 Tauri 后端代理请求喜马拉雅订单接口，规避跨域限制。
            </div>

            {/* 错误提示 */}
            {orderFetchStatus === "error" && orderError && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#ef4444",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <IconX size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>{orderError}</span>
              </div>
            )}

            {/* 订单列表 */}
            {orderFetchStatus === "success" && (
              <>
                {orders.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "20px 0",
                      fontSize: 13,
                      color: "var(--muted)",
                    }}
                  >
                    暂无订单数据
                  </div>
                ) : (
                  <div
                    style={{
                      borderRadius: 6,
                      border: "1px solid var(--line, rgba(0,0,0,0.1))",
                      overflow: "hidden",
                    }}
                  >
                    {/* 表头 */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 2fr 1fr 1fr",
                        background: "var(--nav-hover, rgba(0,0,0,0.04))",
                        padding: "8px 12px",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--muted)",
                        borderBottom: "1px solid var(--line, rgba(0,0,0,0.1))",
                      }}
                    >
                      <span>订单号</span>
                      <span>商品名称</span>
                      <span>金额</span>
                      <span>状态</span>
                    </div>
                    {orders.map((order, idx) => (
                      <div
                        key={order.orderId ?? idx}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 2fr 1fr 1fr",
                          padding: "10px 12px",
                          fontSize: 12,
                          color: "var(--text)",
                          borderBottom:
                            idx < orders.length - 1
                              ? "1px solid var(--line, rgba(0,0,0,0.06))"
                              : "none",
                          alignItems: "center",
                        }}
                      >
                        <code
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            wordBreak: "break-all",
                          }}
                        >
                          {order.orderId ?? "-"}
                        </code>
                        <span style={{ paddingRight: 8 }}>
                          {order.productName ?? "-"}
                        </span>
                        <span>
                          {order.amount != null
                            ? `¥${(order.amount / 100).toFixed(2)}`
                            : "-"}
                        </span>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 11,
                            background: "rgba(34,197,94,0.1)",
                            color: "#16a34a",
                          }}
                        >
                          {order.displayStatus ?? order.orderStatus ?? "-"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--muted)",
                    textAlign: "right",
                  }}
                >
                  共 {orders.length} 条订单
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
