"use client";

import Participants from "@/components/Participants";

const GITHUB_URL = "https://github.com/Se00n00";

function GithubGlyph() {
  // github-square style mark (rounded square + octocat), all white, no backdrop
  return (
    <svg viewBox="0 0 448 512" className="h-7 w-7 sm:h-8 sm:w-8" fill="white" aria-hidden>
      <path d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zM277.3 415.7c-8.4 1.5-11.5-3.7-11.5-8 0-5.4.2-33 .2-55.3 0-15.6-5.2-25.5-11.3-30.7 37-4.1 76-9.2 76-73.1 0-18.2-6.5-27.3-17.1-39 1.7-4.3 7.4-22-1.7-45.9 0 0-13.9-4.5-45.5 17.8-13.2-3.7-27.5-5.6-41.6-5.6-14.1 0-28.4 1.9-41.6 5.6-31.6-22.3-45.5-17.8-45.5-17.8-9.1 23.9-3.4 41.6-1.7 45.9-10.6 11.7-17.1 20.8-17.1 39 0 63.9 38.9 69 75.9 64.9-4.7 4.2-9.2 12.3-9.2 24.8 0 18 .2 52.8.2 57.3 0 4.3-3.1 9.5-11.5 8-66.3-22.1-112.1-84.9-112.1-158.3 0-91.8 70.2-161.5 162-161.5S424 12.7 424 104.5c0 73.4-45.8 136.2-112.1 158.3z" />
    </svg>
  );
}

export default function TopRight() {
  return (
    <div className="flex items-center gap-2 sm:gap-4">
      <Participants />
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub"
        title="GitHub"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center"
      >
        <GithubGlyph />
      </a>
    </div>
  );
}
