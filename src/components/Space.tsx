/** Decorative background: star field, nebula glows and outlined asteroids. */
export function Space() {
  return (
    <div className="space" aria-hidden="true">
      <div className="space__nebula" />
      <div className="space__stars space__stars--far" />
      <div className="space__stars space__stars--near" />
      <svg className="space__asteroid space__asteroid--big" width="150" height="110" viewBox="0 0 150 110">
        <polygon
          points="20,40 55,8 110,14 142,52 120,94 60,102 22,80"
          fill="var(--asteroid-fill)"
          stroke="var(--violet)"
          strokeWidth="1.5"
        />
        <polyline points="55,8 70,48 120,94" fill="none" stroke="var(--asteroid-seam)" strokeWidth="1.5" />
        <polyline points="20,40 70,48 142,52" fill="none" stroke="var(--asteroid-seam)" strokeWidth="1.5" />
      </svg>
      <svg className="space__asteroid space__asteroid--small" width="60" height="50" viewBox="0 0 60 50">
        <polygon points="8,20 26,4 50,12 54,34 30,46 10,38" fill="var(--asteroid-fill)" stroke="var(--cyan)" strokeWidth="1.2" />
      </svg>
      <svg className="space__asteroid space__asteroid--low" width="90" height="70" viewBox="0 0 90 70">
        <polygon points="10,30 34,6 70,10 84,40 62,64 22,60" fill="var(--asteroid-fill)" stroke="var(--violet)" strokeWidth="1.2" />
        <polyline points="34,6 44,34 62,64" fill="none" stroke="var(--asteroid-seam)" strokeWidth="1.2" />
      </svg>
    </div>
  );
}
