// Big friendly title with ONE word in the accent colour: "What should we remember?"
export function AccentTitle({ pre, accent, post, as: Tag = "h1" }: { pre: string; accent: string; post?: string; as?: "h1" | "h2" }) {
  return (
    <Tag className="text-[2rem] font-extrabold leading-[1.1] tracking-tight text-ink">
      {pre ? `${pre} ` : ""}
      <span className="text-accent-text">{accent}</span>
      {post ? ` ${post}` : ""}
    </Tag>
  );
}
