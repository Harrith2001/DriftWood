import type { PanelId } from '../models/experience.model';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EDIT YOUR COPY HERE — this is the only file with human-facing text in it.
 *  Nothing in this file affects the 3D scene or layout; change freely.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const IDENTITY = {
  name: 'Harrith',
  role: 'Creative Developer',
  /** Shown under the name on the intro portrait. */
  tagline: 'I build worlds you can walk around in.',
  email: 'harrith2001@gmail.com',
  location: 'India',
} as const;

export interface PanelContent {
  readonly id: PanelId;
  readonly title: string;
  /** One-line framing shown under the title. */
  readonly kicker: string;
  readonly body: readonly string[];
  readonly items?: readonly PanelItem[];
  readonly links?: readonly PanelLink[];
  /**
   * Small print at the foot of the panel. Used for the environment credit, which
   * is a licence condition rather than a courtesy — see `CREDITS` below.
   */
  readonly credits?: readonly PanelLink[];
}

export interface PanelItem {
  readonly title: string;
  readonly meta?: string;
  readonly description: string;
  readonly tags?: readonly string[];
}

export interface PanelLink {
  readonly label: string;
  readonly href: string;
}

/**
 * Environment attribution.
 *
 * The city model is CC BY 4.0, which permits commercial use but *requires* the
 * author to be credited wherever the work is shared. That makes this a licence
 * obligation, not a nicety: it has to stay visible in the shipped site, not just
 * in the repository. It is surfaced as small print at the foot of the About
 * panel.
 */
export const CREDITS: readonly PanelLink[] = [
  {
    label: 'Environment: “Popular Streets of Lima | PS1 Environment” by McPato, CC BY 4.0',
    href: 'https://sketchfab.com/3d-models/popular-streets-of-lima-ps1-environment-d914a9adf2e24635a5310c909800009d',
  },
];

export const PANELS: Readonly<Record<PanelId, PanelContent>> = {
  about: {
    id: 'about',
    title: 'About',
    kicker: 'The blue house on the corner',
    body: [
      `I'm ${IDENTITY.name}, a creative developer who treats the browser as a
       real-time medium rather than a page. Most of my work sits where
       rendering, motion and interface design overlap.`,
      `I care about the details that survive scrutiny: an animation that
       retargets cleanly, a camera that never clips a wall, a 14 MB payload
       where a 340 MB one would have shipped. Craft is mostly the accumulation
       of refusing to leave things broken.`,
    ],
    items: [
      {
        title: 'Real-time 3D on the web',
        description:
          'Three.js and WebGL — procedural geometry, skeletal animation, custom shaders, post-processing.',
      },
      {
        title: 'Interface engineering',
        description:
          'Angular and TypeScript at the structural level: signals, modular architecture, strict typing.',
      },
      {
        title: 'Motion design',
        description:
          'GSAP timelines, scroll choreography, and the kind of easing you feel rather than notice.',
      },
    ],
    credits: CREDITS,
  },

  projects: {
    id: 'projects',
    title: 'Projects',
    kicker: 'The middle of the plaza',
    body: [
      `A few things I have built. Each one started as a question about what a
       browser could be talked into doing.`,
    ],
    items: [
      {
        title: 'Ocean Portfolio',
        meta: 'Angular 20 · Three.js · GSAP',
        description:
          'This street. A cinematic freefall drops you into a plaza — slow-motion flare, hard landing, dust — then hands you the controls for free third-person exploration with proximity-triggered content. Where you can walk is read off the mesh itself: the environment is rasterised offline into a walkability map, so kerbs, terraces and shopfronts stop you because they are there, not because someone drew a box around them.',
        tags: ['WebGL', 'Skeletal animation', 'Asset pipeline'],
      },
      {
        title: 'Papercraft World',
        meta: 'Vite · Three.js · GSAP · Lenis',
        description:
          'A seasonal portfolio built entirely from procedural geometry — no imported models. Four zones, one continuous scroll-driven camera path, folded-paper aesthetic throughout.',
        tags: ['Procedural geometry', 'Scroll narrative'],
      },
      {
        title: 'More in progress',
        meta: 'Ongoing',
        description:
          'Experiments in shader-driven environments and real-time character control. Ask me about the ones that failed — those are the interesting ones.',
        tags: ['Shaders', 'R&D'],
      },
    ],
  },

  skills: {
    id: 'skills',
    title: 'Skills',
    kicker: 'Outside the shopfronts',
    body: [`Tools I reach for, roughly in order of how often I reach for them.`],
    items: [
      {
        title: '3D & Graphics',
        description: 'Three.js, WebGL, GLSL, glTF pipelines, Blender, gltf-transform.',
        tags: ['Three.js', 'WebGL', 'GLSL', 'glTF'],
      },
      {
        title: 'Frontend',
        description: 'Angular, TypeScript, RxJS, signals, semantic accessible HTML and CSS.',
        tags: ['Angular', 'TypeScript', 'CSS'],
      },
      {
        title: 'Motion',
        description: 'GSAP, ScrollTrigger, Lenis, timeline choreography, easing design.',
        tags: ['GSAP', 'Lenis'],
      },
      {
        title: 'Performance',
        description:
          'Draw-call budgets, texture compression, asset pipelines, quality tiers for low-end devices.',
        tags: ['Profiling', 'Optimisation'],
      },
    ],
  },

  contact: {
    id: 'contact',
    title: 'Contact',
    kicker: 'The bottom of the hill',
    body: [
      `If you have something that should exist and does not yet, I would like to
       hear about it. Freelance, collaboration, or just to compare notes on
       render loops.`,
    ],
    links: [
      { label: IDENTITY.email, href: `mailto:${IDENTITY.email}` },
      { label: 'GitHub', href: 'https://github.com/' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/' },
    ],
  },

  /**
   * The reward for finding all eight caps. No beacon marks it and it is not in
   * the HUD's list — it opens itself the moment the hunt is finished, and stays
   * available afterwards.
   */
  colophon: {
    id: 'colophon',
    title: 'How this was built',
    kicker: 'You found all eight',
    body: [
      `Since you went looking: this street is a real place, and almost none of
       what makes it walkable was authored by hand.`,
    ],
    items: [
      {
        title: 'The ground decides',
        description:
          'Where you can walk is read off the mesh, not drawn over a screenshot. Every triangle is rasterised onto a half-metre grid offline, flood-filled from the point you land on, and everything the fill cannot reach becomes a wall. Re-running it after a model change re-derives the whole map.',
      },
      {
        title: 'Why the stairs work',
        description:
          'A staircase defeats the obvious test: its risers are vertical and its treads are flat, so judging ground by the slope of the triangles under it rejects every stair in the city while happily accepting a smooth bank. What decides it is the height between one foothold and the next.',
      },
      {
        title: 'What stops you',
        description:
          'Two things, and they answer different questions. A generated map knows which ground has no route to it. A pair of rays swept along each step knows a railing, a lamp post or a parked car is in the way — those stand on ground that is walkable either side of them, and no grid describes that.',
      },
      {
        title: 'The payload',
        meta: '292 MB → 9 MB',
        description:
          'Animation exports each bundle a duplicate of the character and a 4K texture set for about 21 KB of keyframes. The build strips them to skeletons, re-encodes every texture per measured alpha, and converts the city out of a materials workflow the renderer stopped supporting.',
      },
    ],
    links: [{ label: 'Read the source', href: 'https://github.com/Harrith2001/DriftWood' }],
    credits: CREDITS,
  },
};

/** Control hints shown in the HUD. Keyboard first, touch appended on mobile. */
export const CONTROL_HINTS = {
  move: 'Move',
  turn: 'Turn',
  run: 'Run',
  interact: 'Open',
} as const;
