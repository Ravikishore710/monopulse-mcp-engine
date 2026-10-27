/**
 * Shared Tailwind UI design tokens and surface classnames referenced across
 * MonoPulse operational panels (AmbientPanel, McpPanel, MemoryPanel, TrustAuditPanel).
 */
export const THEME = {
  SURFACE_CARD: 'border border-[#1F2937] bg-[#111827] rounded-lg',
  SURFACE_CARD_P5: 'border border-[#1F2937] bg-[#111827] rounded-lg p-5',
  SURFACE_DARK: 'border border-[#1F2937] bg-[#0B0F17] rounded-md',
  SURFACE_INSET: 'border border-[#1F2937] bg-[#0B0F17]/90 rounded-lg p-4',
  HEADER_BORDER: 'border-b border-[#1F2937] pb-4',
  INPUT_BASE: 'bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs text-[#F9FAFB]',
  TITLE_H1: 'text-xl font-bold text-[#F9FAFB] font-display',
  TITLE_H2: 'text-sm font-semibold text-[#F9FAFB]',
  TEXT_SUBTITLE: 'text-xs text-[#9CA3AF] mt-1',
  BTN_PRIMARY:
    'px-4 py-2 rounded-md text-xs font-medium bg-[#3B82F6] hover:bg-[#2563EB] text-white transition-colors disabled:opacity-50',
  BTN_SECONDARY:
    'px-3 py-1.5 rounded-md text-xs font-medium border border-[#374151] bg-[#1F2937] hover:bg-[#374151] text-[#E5E7EB] transition-colors'
} as const;

export type ThemeTokenKey = keyof typeof THEME;
