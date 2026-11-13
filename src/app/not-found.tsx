import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">404</div>
        <h1>Lost in the Reach</h1>
        <p className="lede">There is nothing at this address.</p>
      </div>
      <div>
        <Link className="btn" href="/">
          Back to the chronicle
        </Link>
      </div>
    </>
  );
}
