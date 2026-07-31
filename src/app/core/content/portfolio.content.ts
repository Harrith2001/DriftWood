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

export const PANELS: Readonly<Record<PanelId, PanelContent>> = {
  about: {
    id: 'about',
    title: 'About',
    kicker: 'The beach house',
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
  },

  projects: {
    id: 'projects',
    title: 'Projects',
    kicker: 'The pier',
    body: [
      `A few things I have built. Each one started as a question about what a
       browser could be talked into doing.`,
    ],
    items: [
      {
        title: 'Ocean Portfolio',
        meta: 'Angular 20 · Three.js · GSAP',
        description:
          'This island. A cinematic freefall drops you onto a pier — slow-motion flare, hard landing, dust — then hands you the controls for free third-person exploration with proximity-triggered content. Runtime payload cut from 342 MB to 19 MB by stripping duplicate meshes out of the animation exports.',
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
    kicker: 'The changing cabin',
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
    kicker: 'The quiet end of the beach',
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
};

/** Control hints shown in the HUD. Keyboard first, touch appended on mobile. */
export const CONTROL_HINTS = {
  move: 'Move',
  turn: 'Turn',
  run: 'Run',
  interact: 'Open',
} as const;
