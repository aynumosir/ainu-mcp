/** Authorization gating shared by the write/maintenance tools. */
import type { Props } from "./types.js";

/**
 * Defense-in-depth guard for write/maintenance tools. These tools are only
 * *registered* for org members (see mcp.ts), so a non-member never sees them;
 * this guard ensures that even if registration logic changes, the credentialed
 * actions stay org-gated.
 */
export function requireOrgMember(props: Props, tool: string): void {
  if (!props.isOrgMember) {
    throw new Error(
      `'${tool}' requires membership in the aynumosir GitHub organization. ` +
        `You are authenticated as '${props.login}' (read-only access).`,
    );
  }
}
