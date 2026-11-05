/**
 * Phone frame that renders one of the static app screens. Shared by the Hero
 * and AppShowcase sections.
 */
export function PhoneMockup({
  children,
  width = 300,
  className,
  style,
}: {
  children: React.ReactNode;
  width?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        width,
        maxWidth: "100%",
        borderRadius: "2.4rem",
        background: "#0f1116",
        border: "1px solid rgba(255,255,255,0.1)",
        padding: 10,
        boxShadow: "0 40px 80px -30px rgba(0,0,0,0.8)",
        ...style,
      }}
    >
      <div
        style={{
          position: "relative",
          borderRadius: "2rem",
          overflow: "hidden",
          aspectRatio: "512 / 1044",
          background: "#0a0c12",
        }}
      >
        {/* Notch */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            width: 96,
            height: 24,
            borderRadius: 9999,
            background: "#0a0b10",
            zIndex: 10,
          }}
        />
        {children}
      </div>
    </div>
  );
}
