"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/players", label: "Players" },
  { href: "/fates", label: "Fates" },
  { href: "/records", label: "Records" },
  { href: "/cards", label: "Cards" },
  { href: "/campaigns/new", label: "Log a game" },
];

export function NavLinks({ isModerator = false }: { isModerator?: boolean }) {
  const path = usePathname();
  const links = isModerator ? [...LINKS, { href: "/admin/seasons", label: "Seasons" }] : LINKS;
  const current = links.filter((l) => path === l.href || path.startsWith(`${l.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]?.href;
  return (
    <>
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  );
}
