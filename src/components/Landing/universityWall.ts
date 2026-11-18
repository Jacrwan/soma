// The "Used by students at" logo wall on the landing page.
//
// UNIVERSITY_WALL_FULL is the full wall (plus Boston College), saved 2026-11-18 when the owner
// trimmed it for now. To bring it back, point UNIVERSITY_LOGOS at it.
// The logo files all stay in public/university-logos/.

export type UniversityLogo = {
  name: string;
  src: string;
  shape: 'mark' | 'wide';
};

export const UNIVERSITY_WALL_FULL: readonly UniversityLogo[] = [
  { name: 'Stanford University', src: '/university-logos/stanford.svg', shape: 'mark' },
  { name: 'Cornell University', src: '/university-logos/cornell.svg', shape: 'mark' },
  { name: 'UC Berkeley', src: '/university-logos/uc-berkeley.svg', shape: 'mark' },
  { name: 'UCLA', src: '/university-logos/ucla.svg', shape: 'mark' },
  { name: 'UC San Diego', src: '/university-logos/ucsd.png', shape: 'mark' },
  { name: 'Emory University', src: '/university-logos/emory.svg', shape: 'wide' },
  { name: 'UC Irvine', src: '/university-logos/uc-irvine-wordmark.svg', shape: 'wide' },
  { name: 'UC Davis', src: '/university-logos/uc-davis-wordmark.svg', shape: 'wide' },
  { name: 'Carnegie Mellon University', src: '/university-logos/carnegie-mellon.png', shape: 'mark' },
  { name: 'Georgia Tech', src: '/university-logos/georgia-tech.svg', shape: 'mark' },
  { name: 'Rutgers University', src: '/university-logos/rutgers-wordmark.svg', shape: 'wide' },
  { name: 'Boston College', src: '/university-logos/boston-college.svg', shape: 'wide' },
];

const SHOWN_NOW = [
  'UC Berkeley',
  'Cornell University',
  'UC Irvine',
  'Rutgers University',
  'UC Davis',
  'Emory University',
  'Carnegie Mellon University',
  'Boston College',
];

export const UNIVERSITY_LOGOS: readonly UniversityLogo[] = UNIVERSITY_WALL_FULL.filter(u =>
  SHOWN_NOW.includes(u.name),
);
