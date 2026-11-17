/** Prefix for public assets when the app is served under a sub-path (GitHub Pages preview). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const IS_STATIC_PREVIEW = BASE_PATH !== "";
