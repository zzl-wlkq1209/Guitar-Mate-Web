import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type TabPlayerFrameHandle = {
  togglePlayback: () => void;
  stop: () => void;
  saveCurrent: () => void;
};

type TabPlayerFrameProps = {
  darkMode: boolean;
  fontSize: number;
  latencyMs: number;
  revision: number;
  onPlaybackChange: (playing: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
};

const FONT_SIZES = [14, 15, 16, 17, 18];

const TabPlayerFrame = forwardRef<TabPlayerFrameHandle, TabPlayerFrameProps>(function TabPlayerFrame(
  { darkMode, fontSize, latencyMs, revision, onPlaybackChange, onDirtyChange },
  forwardedRef,
) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const postToPlayer = (message: object) => {
    frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
  };

  const syncFrame = () => {
    const frameDocument = frameRef.current?.contentDocument;
    if (!frameDocument) return;

    frameDocument.documentElement.dataset.hostTheme = darkMode ? "dark" : "light";
    frameDocument.documentElement.style.fontSize = `${FONT_SIZES[fontSize] ?? 16}px`;
    frameDocument.documentElement.style.setProperty("--host-font-scale", String((FONT_SIZES[fontSize] ?? 16) / 16));
    postToPlayer({ type: "guitar-mate-tab-latency", value: latencyMs });
  };

  useImperativeHandle(forwardedRef, () => ({
    togglePlayback: () => postToPlayer({ type: "guitar-mate-tab-toggle-playback" }),
    stop: () => postToPlayer({ type: "guitar-mate-tab-stop" }),
    saveCurrent: () => postToPlayer({ type: "guitar-mate-tab-save-current" }),
  }));

  useEffect(() => {
    syncFrame();
  }, [darkMode, fontSize, latencyMs]);

  useEffect(() => {
    const receivePlayerMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return;
      if (event.data?.type === "guitar-mate-tab-playback") {
        onPlaybackChange(Boolean(event.data.playing));
      }
      if (event.data?.type === "guitar-mate-tab-dirty") onDirtyChange(Boolean(event.data.dirty));
      if (event.data?.type === "guitar-mate-tab-ready") syncFrame();
    };
    window.addEventListener("message", receivePlayerMessage);
    return () => window.removeEventListener("message", receivePlayerMessage);
  }, [onPlaybackChange, onDirtyChange]);

  return (
    <section className="tab-player-host" aria-label="吉他谱播放器">
      <iframe
        key={revision}
        ref={frameRef}
        className="tab-player-frame"
        src="./tab-player/index.html?v=20261030-1"
        title="吉他谱播放器"
        onLoad={syncFrame}
        allow="autoplay"
      />
    </section>
  );
});

export default TabPlayerFrame;
