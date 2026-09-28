class GameSimulation {
  constructor(settlements, random = Math.random) {
    this.settlements = settlements.map(city => ({ ...city, maxHealth: city.capital ? 5 : 3, health: city.capital ? 5 : 3 }));
    this.random = random;
    this.time = 0;
    this.resources = 200;
    this.maxMorale = 10;
    this.morale = this.maxMorale;
    this.nextIncome = 60000;
    this.radarCost = 100;
    this.radarRadius = 120;
    this.samCost = 150;
    this.samRadius = 160;
    this.interceptorSpeed = 0.3;
    this.radars = [];
    this.samSites = [];
    this.interceptors = [];
    this.events = [];
    this.nextBuildingId = 1;
    this.nextInterceptorId = 1;
    this.raids = [];
    this.nextRaidId = 1;
    this.maxRaids = 24;
    this.maxUavs = 192;
    this.spawnError = '';
  }
  get income() {
    return this.settlements.reduce((sum, city) => sum + (city.health > 0 ? (city.capital ? 20 : 10) : 0), 0);
  }
  get activeUnitCount() {
    return this.raids.reduce((count, raid) => count + raid.units.filter(unit => !unit.arrived).length, 0);
  }
  get buildings() {
    return [...this.radars, ...this.samSites];
  }
  placeRadar(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Invalid radar position.');
    if (this.resources < this.radarCost) return false;
    this.resources -= this.radarCost;
    this.radars.push({ id: this.nextBuildingId++, type: 'radar', name: `Radar ${this.radars.length + 1}`, x, y, radius: this.radarRadius, health: 1, maxHealth: 1 });
    return true;
  }
  placeSam(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Invalid SAM position.');
    if (this.resources < this.samCost) return false;
    this.resources -= this.samCost;
    this.samSites.push({ id: this.nextBuildingId++, type: 'sam', name: `SAM ${this.samSites.length + 1}`, x, y, radius: this.samRadius, health: 1, maxHealth: 1, ammo: 3, maxAmmo: 3 });
    return true;
  }
  isWithinRadar(x, y, margin = 0) {
    return this.radars.some(radar => radar.health > 0 && Math.hypot(x - radar.x, y - radar.y) <= radar.radius - margin);
  }
  collectIncome(periods) {
    this.resources += periods * this.income;
    this.morale = Math.min(this.maxMorale, this.morale + periods);
    for (const site of this.samSites) if (site.health > 0) site.ammo = Math.min(site.maxAmmo, site.ammo + periods);
    this.nextIncome += periods * 60000;
  }
  spawnRaid(count) {
    if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 12)) throw new RangeError('Use 1–12 UAVs.');
    this.spawnError = '';
    if (this.raids.length >= this.maxRaids) {
      this.spawnError = `Raid limit reached (${this.maxRaids}). Wait for an active raid to finish.`;
      return null;
    }
    const livingCities = this.settlements.filter(city => city.health > 0);
    const livingBuildings = this.buildings.filter(building => building.health > 0);
    if (!livingCities.length && !livingBuildings.length) { this.spawnError = 'No intact targets remaining.'; return null; }
    const sector = Math.floor(this.random() * 8);
    const angle = -Math.PI / 2 + sector * Math.PI / 4 + (this.random() - 0.5) * 0.25;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const distance = Math.min(476 / Math.abs(dx), 356 / Math.abs(dy));
    const origin = { x: 500 + dx * distance, y: 380 + dy * distance };
    const living = livingBuildings.length && (!livingCities.length || this.random() < 0.35) ? livingBuildings : livingCities;
    const nearest = living.slice().sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y)).slice(0, 3);
    const roll = this.random();
    const target = nearest[Math.min(roll < 0.55 ? 0 : roll < 0.85 ? 1 : 2, nearest.length - 1)];
    const unitCount = count ?? (1 + Math.floor(this.random() * 5));
    if (this.activeUnitCount + unitCount > this.maxUavs) {
      this.spawnError = `UAV limit reached (${this.maxUavs}, including pending raids).`;
      return null;
    }
    const travelTime = Math.hypot(target.x - origin.x, target.y - origin.y) / 24 * 1000;
    const warningSeconds = 20 + Math.floor(this.random() * 21);
    const attackAt = this.time + warningSeconds * 1000;
    const raid = {
      id: this.nextRaidId++, type: 'UAV', origin, target,
      warningSeconds, attackAt,
      direction: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][sector], count: unitCount,
      units: Array.from({ length: unitCount }, (_, index) => ({ launchAt: attackAt + index * 1200, impactAt: attackAt + index * 1200 + travelTime, arrived: false })),
    };
    this.raids.push(raid);
    return raid;
  }
  nextEngagement(limit) {
    let best = null;
    for (const site of this.samSites) {
      if (site.health === 0 || site.ammo === 0) continue;
      for (const raid of this.raids) for (const unit of raid.units) {
        if (unit.arrived || unit.interceptor) continue;
        const duration = unit.impactAt - unit.launchAt;
        const vx = (raid.target.x - raid.origin.x) / duration;
        const vy = (raid.target.y - raid.origin.y) / duration;
        const start = Math.max(this.time, unit.launchAt);
        if (start >= unit.impactAt) continue;
        const sx = raid.origin.x - site.x, sy = raid.origin.y - site.y;
        const startX = sx + vx * (start - unit.launchAt);
        const startY = sy + vy * (start - unit.launchAt);
        let launchAt = start;
        if (startX * startX + startY * startY > site.radius * site.radius) {
          const a = vx * vx + vy * vy;
          const b = 2 * (sx * vx + sy * vy);
          const c = sx * sx + sy * sy - site.radius * site.radius;
          const discriminant = b * b - 4 * a * c;
          if (discriminant < 0) continue;
          const entryAt = unit.launchAt + (-b - Math.sqrt(discriminant)) / (2 * a);
          if (entryAt < start - 0.00001 || entryAt >= unit.impactAt) continue;
          launchAt = Math.max(start, entryAt);
        }
        if (launchAt > limit) continue;
        const px = raid.origin.x + vx * (launchAt - unit.launchAt);
        const py = raid.origin.y + vy * (launchAt - unit.launchAt);
        const rx = px - site.x, ry = py - site.y;
        const a = vx * vx + vy * vy - this.interceptorSpeed ** 2;
        const b = 2 * (rx * vx + ry * vy);
        const c = rx * rx + ry * ry;
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) continue;
        const roots = [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)].filter(value => value >= 0);
        if (!roots.length) continue;
        const flight = Math.max(1, Math.min(...roots));
        const hitAt = launchAt + flight;
        if (hitAt >= unit.impactAt) continue;
        if (!best || launchAt < best.launchAt || (launchAt === best.launchAt && unit.impactAt < best.unit.impactAt)) {
          best = { site, raid, unit, launchAt, hitAt, x: px + vx * flight, y: py + vy * flight };
        }
      }
    }
    return best;
  }
  advance(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('Invalid time step.');
    const end = this.time + milliseconds;
    while (this.time < end) {
      if (!this.raids.length && !this.interceptors.length) {
        const payouts = Math.max(0, Math.floor((end - this.nextIncome) / 60000) + 1);
        if (payouts) this.collectIncome(payouts);
        this.time = end;
        break;
      }
      let next = Math.min(end, this.nextIncome);
      for (const raid of this.raids) for (const unit of raid.units) {
        if (!unit.arrived) next = Math.min(next, unit.impactAt);
      }
      for (const interceptor of this.interceptors) next = Math.min(next, interceptor.hitAt);
      const engagement = this.nextEngagement(end);
      if (engagement) next = Math.min(next, engagement.launchAt);
      this.time = next;
      let resolved = false;
      for (const interceptor of this.interceptors) {
        if (interceptor.hitAt > this.time + 0.00001) continue;
        interceptor.unit.arrived = true;
        this.events.push({ type: 'intercept', x: interceptor.x, y: interceptor.y });
        resolved = true;
      }
      this.interceptors = this.interceptors.filter(interceptor => interceptor.hitAt > this.time + 0.00001);
      for (const raid of this.raids) for (const unit of raid.units) {
        if (unit.arrived || unit.impactAt > this.time + 0.00001) continue;
        unit.arrived = true;
        raid.target.health = Math.max(0, raid.target.health - 1);
        this.morale = Math.max(0, this.morale - 1);
        this.events.push({ type: 'impact', x: raid.target.x, y: raid.target.y });
        resolved = true;
      }
      if (resolved) this.raids = this.raids.filter(raid => raid.units.some(unit => !unit.arrived));
      if (this.nextIncome <= this.time + 0.00001) this.collectIncome(1);
      let ready = this.nextEngagement(this.time + 0.00001);
      while (ready && ready.launchAt <= this.time + 0.00001) {
        ready.site.ammo--;
        ready.unit.interceptor = true;
        this.interceptors.push({ id: this.nextInterceptorId++, site: ready.site, unit: ready.unit, launchAt: this.time, hitAt: ready.hitAt, x: ready.x, y: ready.y });
        ready = this.nextEngagement(this.time + 0.00001);
      }
    }
  }
}
if (typeof module !== 'undefined') module.exports = { GameSimulation };
