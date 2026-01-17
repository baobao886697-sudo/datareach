export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL - use local login page instead of OAuth
export const getLoginUrl = () => {
  return "/login";
};
