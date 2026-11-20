/**
 * The campus illustration used beside the landing and sign-in screens: a student with a backpack
 * in front of a teaching block. Drawn in flat shapes in the app's own teal, orange and cream so it
 * needs no image file. It is decoration, so it is hidden from assistive technology.
 */
export function CampusScene({ className }) {
  const windows = [0, 1, 2, 3, 4];
  return (
    <svg
      viewBox="0 0 600 900"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="600" height="900" fill="#6fdfcb" />
      <rect width="600" height="320" fill="#86e6d6" />

      {/* teaching block */}
      <rect x="0" y="560" width="600" height="340" fill="#f7ebcb" />
      <rect x="0" y="548" width="600" height="16" fill="#fff7dd" />
      {windows.map((i) => (
        <g key={i}>
          <rect x={14 + i * 120} y="630" width="84" height="74" fill="#62d5c2" />
          <rect x={14 + i * 120} y="630" width="84" height="6" fill="#4cbfac" />
          <rect x={14 + i * 120} y="770" width="84" height="74" fill="#62d5c2" />
          <rect x={14 + i * 120} y="770" width="84" height="6" fill="#4cbfac" />
        </g>
      ))}
      <rect x="0" y="724" width="600" height="10" fill="#fff7dd" />

      {/* backpack and strap */}
      <rect x="318" y="400" width="190" height="270" rx="56" fill="#f0553a" />
      <rect x="338" y="560" width="120" height="86" rx="22" fill="#e0472d" />
      <path
        d="M300 420 C 290 520 296 650 318 790 L 336 786 C 318 650 316 520 326 420 Z"
        fill="#f0553a"
      />

      {/* legs */}
      <rect x="196" y="800" width="196" height="110" fill="#f59a2e" />

      {/* jacket: one body shape, banded in orange, navy and teal */}
      <defs>
        <clipPath id="campus-jacket">
          <path d="M176 420 L 352 402 C 410 430 442 560 426 760 L 408 790 L 372 826 L 196 842 C 168 700 166 540 176 420 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#campus-jacket)">
        <rect x="150" y="390" width="320" height="460" fill="#17958a" />
        <rect x="150" y="390" width="320" height="150" fill="#f59a2e" />
        <rect x="150" y="540" width="320" height="128" fill="#2f4650" />
        <rect x="206" y="668" width="116" height="116" rx="8" fill="#f3d9b1" />
        <rect x="206" y="668" width="116" height="8" rx="4" fill="#e6c590" />
        <path d="M330 440 C 380 470 392 600 384 780" stroke="#0f7f75" strokeWidth="6" fill="none" />
      </g>
      <circle cx="226" cy="700" r="6" fill="#f3d9b1" />
      <circle cx="394" cy="690" r="9" fill="#f3d9b1" />
      <path d="M318 770 C 318 820 340 842 366 838 L 376 780 Z" fill="#f2b690" />

      {/* hood */}
      <path
        d="M190 330 C 200 270 330 268 424 292 C 452 340 424 420 346 426 C 290 432 214 410 190 330 Z"
        fill="#f59a2e"
      />
      <path
        d="M226 392 C 262 408 308 412 346 404 L 346 426 C 290 440 226 424 214 408 Z"
        fill="#e8861c"
      />
      <path d="M276 360 L 266 440" stroke="#fff3dc" strokeWidth="5" strokeLinecap="round" />

      {/* collar */}
      <path d="M236 330 L 330 322 L 334 392 L 244 398 Z" fill="#1f8f85" />

      {/* head */}
      <ellipse cx="262" cy="232" rx="50" ry="64" fill="#f2b690" />
      <path
        d="M212 222 C 206 168 244 150 286 156 C 316 162 322 196 314 222 C 300 196 252 190 212 222 Z"
        fill="#4a3a33"
      />
      <circle cx="312" cy="248" r="13" fill="#e8a37d" />
      <path
        d="M222 252 C 230 244 250 246 258 254"
        stroke="#cf8d68"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M240 296 C 252 304 270 304 280 296"
        stroke="#cf8d68"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M266 252 L 258 280 L 272 280"
        stroke="#d99772"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />

      {/* glasses */}
      <rect
        x="198"
        y="226"
        width="42"
        height="30"
        rx="8"
        fill="#9be8d6"
        fillOpacity="0.5"
        stroke="#262b30"
        strokeWidth="6"
      />
      <rect
        x="248"
        y="226"
        width="42"
        height="30"
        rx="8"
        fill="#9be8d6"
        fillOpacity="0.5"
        stroke="#262b30"
        strokeWidth="6"
      />
      <path
        d="M240 238 L 248 238 M 290 236 L 308 232"
        stroke="#262b30"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
