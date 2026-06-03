import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Monitor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type WsMessage = {
  type: string;
  agentId?: string;
  status?: string;
  image?: string;
  width?: number;
  height?: number;
  monitors?: Monitor[];
  message?: string;
};

const DEFAULT_WS = 'ws://52.64.151.137:8090/ws/control';
const LOGIN_ENDPOINT = import.meta.env.VITE_LOGIN_ENDPOINT || 'http://52.64.151.137:8080/api/User/Login';
const AUTH_STORAGE_KEY = 'remote-admin-authenticated';

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(LOGIN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, password }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Login failed.');
      }

      sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
      onLogin();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div>
          <h1>Remote Admin</h1>
          <p>Sign in to manage remote sessions.</p>
        </div>

        <label>
          User ID
          <input
            value={userId}
            onChange={e => setUserId(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button type="submit" disabled={loading}>{loading ? 'Logging in...' : 'Log in'}</button>
      </form>
    </main>
  );
}

function RemoteMonitorView({
  frame,
  monitor,
  index,
  sendPointer,
}: {
  frame: string;
  monitor: Monitor;
  index: number;
  sendPointer: (type: 'MOUSE_MOVE' | 'MOUSE_CLICK', x: number, y: number, button?: 'LEFT' | 'RIGHT') => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const image = new Image();
    image.onload = () => {
      canvas.width = monitor.width;
      canvas.height = monitor.height;
      ctx.drawImage(
        image,
        monitor.x,
        monitor.y,
        monitor.width,
        monitor.height,
        0,
        0,
        monitor.width,
        monitor.height,
      );
    };
    image.src = frame;
  }, [frame, monitor]);

  const getPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: monitor.x, y: monitor.y };

    const rect = canvas.getBoundingClientRect();
    const x = monitor.x + Math.round(((event.clientX - rect.left) / rect.width) * monitor.width);
    const y = monitor.y + Math.round(((event.clientY - rect.top) / rect.height) * monitor.height);
    return { x, y };
  };

  return (
    <div className="monitor-view">
      <div className="monitor-title">
        <span>화면 {index + 1}</span>
        <small>{monitor.width} x {monitor.height}</small>
      </div>
      <canvas
        ref={canvasRef}
        className="monitor-canvas"
        onMouseMove={(event) => {
          const { x, y } = getPoint(event);
          sendPointer('MOUSE_MOVE', x, y);
        }}
        onClick={(event) => {
          const { x, y } = getPoint(event);
          sendPointer('MOUSE_CLICK', x, y, 'LEFT');
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          const { x, y } = getPoint(event);
          sendPointer('MOUSE_CLICK', x, y, 'RIGHT');
        }}
      />
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true');
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS);
  const [agentId, setAgentId] = useState('');
  const [connected, setConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState('unknown');
  const [log, setLog] = useState<string[]>([]);
  const [frame, setFrame] = useState('');
  const [remoteSize, setRemoteSize] = useState({ width: 1, height: 1 });
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [text, setText] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  const appendLog = (message: string) => {
    setLog(prev => [`${new Date().toLocaleTimeString()} ${message}`, ...prev].slice(0, 20));
  };

  const connect = () => {
    if (!agentId.trim()) {
      alert('Agent ID를 입력하세요.');
      return;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'REGISTER_ADMIN', agentId }));
      appendLog('관리자 WebSocket 연결됨');
    };

    ws.onmessage = (event) => {
      const data: WsMessage = JSON.parse(event.data);
      if (data.type === 'FRAME' && data.image) {
        const width = data.width || 1;
        const height = data.height || 1;

        setFrame(`data:image/jpeg;base64,${data.image}`);
        setRemoteSize({ width, height });
        setMonitors(data.monitors?.length ? data.monitors : [{ x: 0, y: 0, width, height }]);
        return;
      }

      if (data.type === 'AGENT_ONLINE') setAgentStatus('online');
      if (data.type === 'AGENT_OFFLINE') setAgentStatus('offline');
      appendLog(`${data.type}${data.message ? ` - ${data.message}` : ''}`);
    };

    ws.onclose = () => {
      setConnected(false);
      setAgentStatus('unknown');
      appendLog('WebSocket 연결 종료');
    };

    ws.onerror = () => appendLog('WebSocket 오류');
  };

  const disconnect = () => {
    wsRef.current?.close();
    wsRef.current = null;
  };

  const send = (payload: object) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ agentId, ...payload }));
  };

  const sendPointer = (
    type: 'MOUSE_MOVE' | 'MOUSE_CLICK',
    x: number,
    y: number,
    button?: 'LEFT' | 'RIGHT',
  ) => {
    send({ type, x, y, ...(button ? { button } : {}) });
  };

  const sendText = () => {
    send({ type: 'KEY_TYPE', text });
    setText('');
  };

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  const logout = () => {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    disconnect();
    setAuthenticated(false);
  };

  if (!authenticated) {
    return <LoginView onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <div className="page">
      <header>
        <h1>Remote Admin MVP</h1>
        <button onClick={logout}>Log out</button>
        <p>Agent 사용자가 직접 허용한 PC에만 마우스와 키보드 명령을 보냅니다.</p>
      </header>

      <section className="panel grid">
        <label>
          WebSocket URL
          <input value={wsUrl} onChange={e => setWsUrl(e.target.value)} />
        </label>
        <label>
          Agent ID
          <input value={agentId} onChange={e => setAgentId(e.target.value)} placeholder="Agent 창에 표시된 ID" />
        </label>
        <div className="buttons">
          {!connected ? <button onClick={connect}>연결</button> : <button onClick={disconnect}>해제</button>}
        </div>
      </section>

      <section className="status">
        <span>WebSocket: <b>{connected ? 'connected' : 'disconnected'}</b></span>
        <span>Agent: <b className={agentStatus}>{agentStatus}</b></span>
        <span>Remote Size: {remoteSize.width} x {remoteSize.height}</span>
        <span>Monitors: {monitors.length || 0}</span>
      </section>

      <section className="viewer">
        {frame ? (
          <div className="monitor-list">
            {monitors.map((monitor, index) => (
              <RemoteMonitorView
                key={`${monitor.x}-${monitor.y}-${monitor.width}-${monitor.height}-${index}`}
                frame={frame}
                monitor={monitor}
                index={index}
                sendPointer={sendPointer}
              />
            ))}
          </div>
        ) : (
          <div className="empty">Agent 화면 대기 중</div>
        )}
      </section>

      <section className="panel controls">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="원격 PC에 입력할 텍스트" />
        <button onClick={sendText}>텍스트 전송</button>
        <button onClick={() => send({ type: 'KEY_PRESS', key: 'ENTER' })}>Enter</button>
        <button onClick={() => send({ type: 'KEY_PRESS', key: 'BACKSPACE' })}>Backspace</button>
        <button onClick={() => send({ type: 'KEY_PRESS', key: 'ESCAPE' })}>Esc</button>
      </section>

      <section className="log">
        {log.map((item, idx) => <div key={idx}>{item}</div>)}
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
