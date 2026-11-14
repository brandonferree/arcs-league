/**
 * The "no photos" badge (spec section 4): shown while a campaign's recorded acts
 * are missing their board or tableau photos. Nothing once every photo is in;
 * callers pass expected = 0 for void campaigns, which do not count anywhere.
 */
export function PhotosBadge({ have, expected }: { have: number; expected: number }) {
  if (expected === 0 || have >= expected) return null;
  const title = `${have} of ${expected} photos: a board photo and one per player, for each recorded act`;
  return (
    <span className="badge badge--photos" title={title}>
      {have === 0 ? "No photos" : `Photos ${have}/${expected}`}
    </span>
  );
}
