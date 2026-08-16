export const STYLE_ID = 'dsh-evolve-web'

export const cssText = `
.dsh-evolve-trigger{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:3px 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.dsh-evolve-trigger:hover,.dsh-evolve-trigger:focus-visible{background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-primary)}
.dsh-evolve-badge{display:inline-grid;min-width:17px;height:17px;padding:0 4px;place-items:center;border-radius:9px;background:var(--dsw-alias-fill-l2);font-size:10px;font-variant-numeric:tabular-nums}
.dsh-evolve-panel{position:fixed;top:64px;right:24px;z-index:220;display:flex;box-sizing:border-box;flex-direction:column;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 88px);overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3)}
.dsh-evolve-head,.dsh-evolve-actions,.dsh-evolve-summary,.dsh-evolve-review-head{display:flex;align-items:center;gap:8px}
.dsh-evolve-head{padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-evolve-title{flex:1;margin:0;font-size:15px;line-height:22px}
.dsh-evolve-close,.dsh-evolve-button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-fill-l1);color:inherit;font:inherit;cursor:pointer}
.dsh-evolve-close{width:28px;height:28px;border:0;background:transparent;font-size:20px}
.dsh-evolve-body{display:flex;flex-direction:column;gap:14px;padding:14px 16px;overflow:auto}
.dsh-evolve-summary{align-items:stretch;flex-wrap:wrap}
.dsh-evolve-stat{min-width:112px;flex:1;padding:10px;border-radius:10px;background:var(--dsw-alias-fill-l1)}
.dsh-evolve-stat-label{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-evolve-stat-value{display:block;margin-top:3px;overflow:hidden;font-size:12px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.dsh-evolve-actions{flex-wrap:wrap}
.dsh-evolve-button{padding:6px 10px;font-size:12px}
.dsh-evolve-button:hover:not(:disabled){background:var(--dsw-alias-fill-l2)}
.dsh-evolve-button:disabled{cursor:not-allowed;opacity:.45}
.dsh-evolve-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:white}
.dsh-evolve-danger{color:var(--dsw-alias-red)}
.dsh-evolve-section-title{margin:0 0 8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-evolve-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-evolve-review{padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.dsh-evolve-review-head{align-items:flex-start}
.dsh-evolve-review-copy{min-width:0;flex:1}
.dsh-evolve-review-skill{font:600 12px var(--dsw-font-mono)}
.dsh-evolve-review-claim{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-evolve-meta{margin-top:8px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-evolve-detail-grid{display:grid;grid-template-columns:max-content 1fr;gap:5px 10px;font-size:12px}
.dsh-evolve-detail-grid dt{color:var(--dsw-alias-label-tertiary)}
.dsh-evolve-detail-grid dd{min-width:0;margin:0;overflow-wrap:anywhere}
.dsh-evolve-claim-card{padding:10px;border-radius:10px;background:var(--dsw-alias-fill-l1)}
.dsh-evolve-claim-card p{margin:4px 0 0;font-size:13px;line-height:19px}
.dsh-evolve-diff{max-height:260px;margin:6px 0 0;padding:10px;overflow:auto;border-radius:8px;background:var(--dsw-alias-fill-l1);font:11px/17px var(--dsw-font-mono);white-space:pre-wrap}
.dsh-evolve-note{box-sizing:border-box;width:100%;min-height:64px;padding:8px 10px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-fill-l1);color:inherit;font:12px/18px inherit}
.dsh-evolve-message{padding:8px 10px;border-radius:8px;background:var(--dsw-alias-fill-l1);font-size:12px;line-height:18px}
.dsh-evolve-error{color:var(--dsw-alias-red)}
.dsh-evolve-confirm-backdrop{position:fixed;inset:0;z-index:230;display:grid;padding:24px;place-items:center;background:rgba(0,0,0,.28)}
.dsh-evolve-confirm{width:min(420px,100%);padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3)}
.dsh-evolve-confirm p{margin:0 0 16px;font-size:13px;line-height:20px}
`
