"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/players", label: "Players" },
  { href: "/fates", label: "Fates" },
  { href: "/records", label: "Records" },
  { href: "/campaigns/new", label: "Log a game" },
];

export function NavLinks() {
  const path = usePathname();
  const current = LINKS.filter((l) => path === l.href || path.startsWith(`${l.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]?.href;
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  );
}
