/** Mission debrief graphs (G key / game over). */
// Death debrief stat tracking (sampled every ~1 s)
export const _statHp = [100], _statScore = [0], _statXp = [0], _statLvl = [1];
export const _deathGraphEl = (() => {
    const div = document.createElement('div');
    div.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(5,5,15,0.96);border:1px solid #334;border-radius:10px;padding:22px 26px;z-index:600;color:#ccd;font-family:monospace;width:min(640px, 94vw);box-sizing:border-box;';
    div.innerHTML = '<div style="text-align:center;font-size:17px;letter-spacing:3px;color:#ffdd88;margin-bottom:12px">— MISSION DEBRIEF —</div>' +
        '<canvas id="_deathCanvas" role="img" width="590" height="360" style="max-width:100%;height:auto"></canvas>' +
        '<div id="_deathSummary" style="text-align:center;font-size:13px;color:#aab;margin-top:8px"></div>' +
        '<div class="menu-buttons menu-row"><button type="button" data-action="restart">Restart</button><button type="button" data-action="replay">Replay this map</button></div>' +
        '<div style="text-align:center;font-size:11px;color:#667;margin-top:8px">[G] toggle debrief · Enter restart</div>';
    document.body.appendChild(div); return div;
})();
export function _drawDeathGraph() {
    const cv = document.getElementById('_deathCanvas'); if (!cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.fillStyle = '#090912'; ctx.fillRect(0, 0, W, H);
    const pad = 38, stripH = 72, gap = 10;
    const rows = [
        { data: _statHp,    label: 'HP',    color: '#ff4455', max: 100 },
        { data: _statScore, label: 'Score', color: '#4488ff', max: null },
        { data: _statXp,    label: 'XP',    color: '#44ee88', max: null },
        { data: _statLvl,   label: 'Level', color: '#ffcc44', max: null },
    ];
    rows.forEach((row, ri) => {
        const y0 = pad + ri * (stripH + gap);
        const maxVal = row.max || Math.max(...row.data, 1);
        ctx.fillStyle = '#0d0d1a'; ctx.fillRect(pad, y0, W - pad * 2, stripH);
        ctx.strokeStyle = '#1a1a30'; ctx.lineWidth = 1;
        for (let g = 0; g <= 4; g++) { ctx.beginPath(); ctx.moveTo(pad, y0 + g * stripH / 4); ctx.lineTo(W - pad, y0 + g * stripH / 4); ctx.stroke(); }
        if (row.data.length >= 2) {
            ctx.strokeStyle = row.color; ctx.lineWidth = 2; ctx.beginPath();
            row.data.forEach((v, i) => {
                const x = pad + (i / (row.data.length - 1)) * (W - pad * 2);
                const y = y0 + stripH - (Math.min(v, maxVal) / maxVal) * stripH;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }); ctx.stroke();
        }
        ctx.fillStyle = row.color; ctx.font = '11px monospace';
        ctx.fillText(`${row.label}  (peak: ${Math.max(...row.data)})`, pad + 2, y0 - 4);
    });
    const secs = _statHp.length - 1;
    ctx.fillStyle = '#334'; ctx.font = '10px monospace';
    ctx.fillText(`0 s`, pad, H - 6); ctx.fillText(`${secs} s`, W - pad - 20, H - 6);
    // Text summary of the charts (also the canvas's accessible name)
    const summary = `Survived ${secs} s · final score ${_statScore[_statScore.length - 1]} · level ${Math.max(..._statLvl)} · peak XP ${Math.max(..._statXp)} · map seed ${window.__vpSeed ?? '—'}`;
    cv.setAttribute('aria-label', summary);
    const summaryEl = document.getElementById('_deathSummary');
    if (summaryEl) summaryEl.textContent = summary;
}
