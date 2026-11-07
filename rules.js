// rules.js — AI 없이 낱말 규칙으로 칸 · 긴급도를 가른다.
// 낱말은 keywords.json, 칸 순서와 긴급도 단계는 criteria.json 에서 받는다.
(function () {
  function hitsOf(text, items) {
    return (items || []).map((it) => it.낱말).filter((w) => text.includes(w));
  }

  // 칸: 맞은 낱말이 가장 많은 칸. 같으면 criteria.json 순서에서 앞 칸.
  //     아무 낱말도 안 맞으면 순서의 마지막 칸(기타).
  function pickCategory(text, criteria, keywords) {
    const order = criteria.순서;
    let best = null;
    let bestHits = [];
    for (const name of order) {
      const hits = hitsOf(text, keywords.칸[name]);
      if (hits.length > bestHits.length) {
        best = name;
        bestHits = hits;
      }
    }
    if (!best) return { name: order[order.length - 1], hits: [] };
    return { name: best, hits: bestHits };
  }

  // 긴급도: 맞은 낱말이 가장 많은 단계. 같거나 하나도 없으면 가운데 단계(보통).
  function pickUrgency(text, criteria, keywords) {
    const levels = criteria.긴급도.map((u) => u.이름);
    const middle = levels[Math.floor(levels.length / 2)];
    let best = middle;
    let bestHits = [];
    let tie = false;
    for (const name of levels) {
      const hits = hitsOf(text, keywords.긴급도[name]);
      if (hits.length > bestHits.length) {
        best = name;
        bestHits = hits;
        tie = false;
      } else if (hits.length > 0 && hits.length === bestHits.length) {
        tie = true;
      }
    }
    if (tie) return { name: middle, hits: [], tie: true };
    return { name: best, hits: bestHits, tie: false };
  }

  function quote(words) {
    return words.map((w) => "‘" + w + "’").join(" ");
  }

  function classify(maskedText, criteria, keywords) {
    const c = pickCategory(maskedText, criteria, keywords);
    const u = pickUrgency(maskedText, criteria, keywords);
    const cPart = c.hits.length ? c.name + " 낱말 " + quote(c.hits) : "맞는 칸 낱말이 없어 " + c.name;
    const uPart = u.hits.length
      ? u.name + " 낱말 " + quote(u.hits)
      : u.tie
        ? "긴급도 낱말이 맞서서 " + u.name
        : "긴급도 낱말이 없어 " + u.name;
    return { 칸: c.name, 긴급도: u.name, 이유: cPart + " · " + uPart };
  }

  window.Rules = { classify };
})();
