/** Native CLI 2.1.296 / SDK 0.2.141 do not preserve these controls on Haiku
 * 5.5: disabled is omitted (the API defaults to adaptive), and omitted display
 * becomes updates. Refuse before generation rather than silently changing
 * explicit intent. Requalify this guard against native evidence before lifting
 * it; it does not claim that the model's API itself lacks these capabilities. */
export function haikuThinkingCompatibilityError(
  resolvedModel: string | undefined,
  thinking?: { type: string; display?: string },
): string | undefined {
  if (resolvedModel !== "claude-haiku-5-5") return undefined
  if (thinking?.type === "disabled") {
    return "Claude Haiku 5.5 through the Claude Code SDK cannot reliably honor thinking: disabled. Use adaptive thinking with effort, or explicitly select claude-haiku-4-5."
  }
  if (thinking?.display === "omitted") {
    return "Claude Haiku 5.5 through the Claude Code SDK cannot reliably honor thinking.display: omitted. Omit display or use summarized, or explicitly select claude-haiku-4-5."
  }
  return undefined
}
