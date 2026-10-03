const KEY = 'wanderer-save-v1';
export class Save {
  constructor() {
    this.data = { stars: [], places: [], friends: [], critters: [], muted: false };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
  }
  write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }
  has(list, id) { return this.data[list].includes(id); }
  add(list, id) {
    if (this.data[list].includes(id)) return false;
    this.data[list].push(id);
    this.write();
    return true;
  }
  reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }
}
