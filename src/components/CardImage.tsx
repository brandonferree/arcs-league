import { cardImageUrl } from "@/lib/cards";

/**
 * Our copy of a card image (Buried Giant Studios, used with permission).
 * Cards are 744x1039; the box keeps that shape before the image loads.
 */
export function CardImage({
  id,
  name,
  imageV,
  size = "thumb",
  className = "",
  eager = false,
}: {
  id: string;
  name: string;
  imageV: number | null | undefined;
  size?: "full" | "thumb";
  className?: string;
  eager?: boolean;
}) {
  const src = cardImageUrl(id, size, imageV);
  if (!src) {
    return (
      <span className={`card-img card-img--missing ${className}`} role="img" aria-label={`${name} (image not copied yet)`}>
        {name}
      </span>
    );
  }
  return (
    <img
      className={`card-img ${className}`}
      src={src}
      alt={name}
      width={744}
      height={1039}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
