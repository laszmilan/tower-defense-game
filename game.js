(() => {
  const svgNS = 'http://www.w3.org/2000/svg';
  function svgElement(tag, attributes) {
    const element = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }
  const cityElements = [...document.querySelectorAll('.town, .capital')];
  const simulation = new GameSimulation(cityElements.map((element, id) => {
    const [x, y] = element.getAttribute('transform').match(/[\d.]+/g).map(Number);
    return { id, x, y, name: element.querySelector('text').textContent, capital: element.classList.contains('capital') };
  }));
  const riverSegments = [];
  for (const river of document.querySelectorAll('.river path')) {
    const length = river.getTotalLength();
    let previous = river.getPointAtLength(0);
    for (let distance = 4; distance < length + 4; distance += 4) {
      const next = river.getPointAtLength(Math.min(distance, length));
      riverSegments.push([previous, next]);
      previous = next;
    }
  }
  const healthDisplays = simulation.settlements.map((city, index) => {
    const element = cityElements[index];
    const label = element.querySelector('text');
    const width = city.maxHealth * 7 - 2;
    const labelX = Number(label.getAttribute('x'));
    const x = label.getAttribute('text-anchor') === 'end' ? labelX - width : labelX;
    const group = svgElement('g', { 'aria-label': `${city.health}/${city.maxHealth} health` });
    const pips = Array.from({ length: city.maxHealth }, (_, i) => {
      const pip = svgElement('rect', { x: x + i * 7, y: -15, width: 5, height: 2, class: 'health-pip' });
      group.append(pip);
      return pip;
    });
    element.append(group);
    return { group, pips, previousHealth: -1 };
  });
  const resourceDisplay = document.querySelector('#resources');
  const moraleDisplay = document.querySelector('#morale');
  const incomeDisplay = document.querySelector('#income');
  const radarButton = document.querySelector('#build-radar');
  const radarStatus = document.querySelector('#radar-status');
  const samButton = document.querySelector('#build-sam');
  const samStatus = document.querySelector('#sam-status');
  const samAmmo = document.querySelector('#sam-ammo');
  const map = document.querySelector('#map');
  const country = document.querySelector('#country');
  const radarLayer = document.querySelector('#radars');
  const samLayer = document.querySelector('#sam-sites');
  const radarPreview = document.querySelector('#radar-preview');
  const previewRange = document.querySelector('#preview-range');
  const pauseStatus = document.querySelector('#pause-status');
  const speedButtons = [...document.querySelectorAll('[data-speed]')];
  const debugPanel = document.querySelector('#debug-panel');
  const raidLayer = document.querySelector('#raids');
  const interceptorLayer = document.querySelector('#interceptors');
  const effectsLayer = document.querySelector('#effects');
  const raidDisplays = new Map();
  const buildingDisplays = new Map();
  const interceptorDisplays = new Map();
  const effects = [];
  let speed = 1;
  let paused = false;
  let placingBuilding = null;
  let previousTime = performance.now();
  function render() {
    const resources = simulation.resources.toLocaleString('en-US');
    if (resourceDisplay.textContent !== resources) resourceDisplay.textContent = resources;
    const morale = `${simulation.morale} / ${simulation.maxMorale}`;
    if (moraleDisplay.textContent !== morale) moraleDisplay.textContent = morale;
    radarButton.disabled = placingBuilding !== 'radar' && simulation.resources < simulation.radarCost;
    radarButton.textContent = placingBuilding === 'radar' ? 'Cancel placement' : 'Place radar';
    samButton.disabled = placingBuilding !== 'sam' && simulation.resources < simulation.samCost;
    samButton.textContent = placingBuilding === 'sam' ? 'Cancel placement' : 'Place SAM site';
    const radarMessage = placingBuilding === 'radar' ? 'Choose land away from rivers, cities, and buildings. Red means blocked; Esc cancels.'
      : simulation.resources < simulation.radarCost ? `Earn ${simulation.radarCost - simulation.resources} more resources to place a radar.`
      : `${simulation.radars.filter(radar => radar.health > 0).length} active · Click Place radar, then choose a map location.`;
    if (radarStatus.textContent !== radarMessage) radarStatus.textContent = radarMessage;
    const samMessage = placingBuilding === 'sam' ? 'Choose land away from rivers, cities, and buildings. Red means blocked; Esc cancels.'
      : simulation.resources < simulation.samCost ? `Earn ${simulation.samCost - simulation.resources} more resources to place a SAM site.`
      : `${simulation.samSites.filter(site => site.health > 0).length} active · Click Place SAM site, then choose a map location.`;
    if (samStatus.textContent !== samMessage) samStatus.textContent = samMessage;
    const ammo = simulation.samSites.filter(site => site.health > 0).map(site => `${site.name}: ${site.ammo}/${site.maxAmmo}`).join(' · ') || 'No SAM sites active.';
    if (samAmmo.textContent !== ammo) samAmmo.textContent = ammo;
    const seconds = Math.ceil((simulation.nextIncome - simulation.time) / 1000);
    const income = `(+${simulation.income} in ${seconds} second${seconds === 1 ? '' : 's'})`;
    if (incomeDisplay.textContent !== income) incomeDisplay.textContent = income;
    simulation.settlements.forEach((city, index) => {
      const display = healthDisplays[index];
      if (display.previousHealth === city.health) return;
      display.previousHealth = city.health;
      display.group.setAttribute('aria-label', `${city.health}/${city.maxHealth} health`);
      cityElements[index].setAttribute('aria-label', `${city.name}: ${city.health}/${city.maxHealth} health`);
      cityElements[index].classList.toggle('destroyed', city.health === 0);
      display.pips.forEach((pip, i) => pip.classList.toggle('lost', i >= city.health));
    });
    for (const building of simulation.buildings) {
      const display = buildingDisplays.get(building.id);
      if (!display) continue;
      if (building.health === 0) { display.group.remove(); buildingDisplays.delete(building.id); continue; }
      if (display.pips) display.pips.forEach((pip, index) => pip.classList.toggle('empty', index >= building.ammo));
    }
    const active = new Set(simulation.raids.map(raid => raid.id));
    for (const [id, display] of raidDisplays) {
      if (!active.has(id)) { display.group.remove(); raidDisplays.delete(id); }
    }
    for (const raid of simulation.raids) {
      let display = raidDisplays.get(raid.id);
      if (!display) {
        const angle = Math.atan2(raid.target.y - raid.origin.y, raid.target.x - raid.origin.x) * 180 / Math.PI;
        const group = svgElement('g', { transform: `translate(${raid.origin.x} ${raid.origin.y}) rotate(${angle})` });
        const arrow = svgElement('path', { class: 'raid-direction', d: 'M 0,-5 L 40,-9 36,-17 66,0 36,17 40,9 0,5 Z' });
        // All UAV markers in a raid share one SVG path and transform.
        const tracks = svgElement('path', { class: 'uav', d: '' });
        const countdown = svgElement('text', {
          class: 'raid-countdown', 'text-anchor': 'middle',
          transform: `translate(33 -24) rotate(${-angle})`,
        });
        group.append(arrow, tracks, countdown);
        raidLayer.append(group);
        display = { group, arrow, tracks, countdown, warning: null, lastTracks: '', distance: Math.hypot(raid.target.x - raid.origin.x, raid.target.y - raid.origin.y) };
        raidDisplays.set(raid.id, display);
      }
      const warning = simulation.time < raid.attackAt;
      const seconds = warning ? `${Math.ceil((raid.attackAt - simulation.time) / 1000)}s` : '';
      if (display.countdown.textContent !== seconds) display.countdown.textContent = seconds;
      if (display.warning !== warning) {
        display.warning = warning;
        display.arrow.classList.toggle('raid-warning', warning);
        display.arrow.setAttribute('visibility', warning ? 'visible' : 'hidden');
        display.group.setAttribute('aria-label', `${warning ? 'UAV warning' : 'UAV raid'} from ${raid.direction}`);
      }
      const paths = [];
      if (!warning) {
        for (const unit of raid.units) {
          if (unit.arrived || simulation.time < unit.launchAt) continue;
          const progress = (simulation.time - unit.launchAt) / (unit.impactAt - unit.launchAt);
          const worldX = raid.origin.x + (raid.target.x - raid.origin.x) * progress;
          const worldY = raid.origin.y + (raid.target.y - raid.origin.y) * progress;
          if (!simulation.isWithinRadar(worldX, worldY, 6)) continue;
          const x = (display.distance * progress + 5).toFixed(2);
          paths.push(`M ${x},0 l -9,-3 2,3 -2,3 Z`);
        }
      }
      const tracks = paths.join(' ');
      if (display.lastTracks !== tracks) {
        display.tracks.setAttribute('d', tracks);
        display.lastTracks = tracks;
      }
    }
    const activeInterceptors = new Set(simulation.interceptors.map(interceptor => interceptor.id));
    for (const [id, marker] of interceptorDisplays) {
      if (!activeInterceptors.has(id)) { marker.remove(); interceptorDisplays.delete(id); }
    }
    for (const interceptor of simulation.interceptors) {
      let marker = interceptorDisplays.get(interceptor.id);
      if (!marker) {
        marker = svgElement('circle', { class: 'interceptor', r: 3 });
        interceptorLayer.append(marker);
        interceptorDisplays.set(interceptor.id, marker);
      }
      const progress = Math.max(0, Math.min(1, (simulation.time - interceptor.launchAt) / (interceptor.hitAt - interceptor.launchAt)));
      marker.setAttribute('cx', interceptor.site.x + (interceptor.x - interceptor.site.x) * progress);
      marker.setAttribute('cy', interceptor.site.y + (interceptor.y - interceptor.site.y) * progress);
    }
    for (const event of simulation.events.splice(0)) {
      const group = svgElement('g', { transform: `translate(${event.x} ${event.y})` });
      const ring = svgElement('circle', { class: event.type === 'intercept' ? 'impact-ring intercept-ring' : 'impact-ring', r: 2 });
      const core = svgElement('circle', { class: event.type === 'intercept' ? 'impact-core intercept-core' : 'impact-core', r: 4 });
      group.append(ring, core);
      effectsLayer.append(group);
      effects.push({ group, ring, core, startedAt: performance.now() });
    }
    const now = performance.now();
    for (let index = effects.length - 1; index >= 0; index--) {
      const effect = effects[index];
      const progress = Math.min(1, (now - effect.startedAt) / 450);
      if (progress >= 1) { effect.group.remove(); effects.splice(index, 1); continue; }
      effect.ring.setAttribute('r', 2 + progress * 18);
      effect.ring.setAttribute('opacity', 1 - progress);
      effect.core.setAttribute('r', 4 + progress * 4);
      effect.core.setAttribute('opacity', 1 - progress);
    }
  }

  function advance(now) {
    const currentTime = Math.max(previousTime, now);
    if (!paused) simulation.advance((currentTime - previousTime) * speed);
    previousTime = currentTime;
  }
  function renderControls() {
    speedButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === speed)));
    pauseStatus.hidden = !paused;
  }
  function togglePause() {
    advance(performance.now());
    paused = !paused;
    renderControls();
    render();
  }
  function setSpeed(value) {
    advance(performance.now());
    speed = value;
    renderControls();
  }
  function setPlacement(type) {
    placingBuilding = type;
    map.classList.toggle('placing-building', Boolean(type));
    radarPreview.classList.toggle('sam-preview', type === 'sam');
    previewRange.setAttribute('r', type === 'sam' ? simulation.samRadius : simulation.radarRadius);
    radarPreview.setAttribute('visibility', 'hidden');
    render();
  }
  function mapPoint(event) {
    const point = map.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(map.getScreenCTM().inverse());
  }
  function canPlaceBuilding(point) {
    if (!country.isPointInFill(point)) return false;
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI / 4;
      if (!country.isPointInFill({ x: point.x + Math.cos(angle) * 8, y: point.y + Math.sin(angle) * 8 })) return false;
    }
    if (simulation.settlements.some(city => Math.hypot(point.x - city.x, point.y - city.y) < 18)) return false;
    if (simulation.buildings.some(building => building.health > 0 && Math.hypot(point.x - building.x, point.y - building.y) < 20)) return false;
    return !riverSegments.some(([a, b]) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const position = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(point.x - a.x - position * dx, point.y - a.y - position * dy) < 10;
    });
  }
  function addBuildingDisplay(building) {
    const group = svgElement('g', { transform: `translate(${building.x} ${building.y})`, 'aria-label': `${building.name}: ${building.health} health` });
    let pips = null;
    if (building.type === 'radar') {
      const sweepX = (building.radius * Math.sin(Math.PI / 7)).toFixed(2);
      const sweepY = (-building.radius * Math.cos(Math.PI / 7)).toFixed(2);
      const scan = svgElement('path', { class: 'radar-scan', d: `M 0,0 L 0,-${building.radius} A ${building.radius},${building.radius} 0 0 1 ${sweepX},${sweepY} Z` });
      scan.append(svgElement('animateTransform', { attributeName: 'transform', type: 'rotate', from: '0 0 0', to: '360 0 0', dur: '4s', repeatCount: 'indefinite' }));
      group.append(svgElement('circle', { class: 'radar-range', r: building.radius }), scan, svgElement('circle', { class: 'radar-core', r: 6 }));
      radarLayer.append(group);
    } else {
      pips = Array.from({ length: building.maxAmmo }, (_, index) => svgElement('rect', { class: 'sam-ammo-pip', x: -9 + index * 7, y: 12, width: 5, height: 3 }));
      group.append(svgElement('circle', { class: 'sam-range', r: building.radius }), svgElement('rect', { class: 'sam-core', x: -7, y: -7, width: 14, height: 14 }), ...pips);
      samLayer.append(group);
    }
    buildingDisplays.set(building.id, { group, pips });
  }
  radarButton.addEventListener('click', () => {
    advance(performance.now());
    if (placingBuilding !== 'radar' && simulation.resources < simulation.radarCost) return;
    setPlacement(placingBuilding === 'radar' ? null : 'radar');
  });
  samButton.addEventListener('click', () => {
    advance(performance.now());
    if (placingBuilding !== 'sam' && simulation.resources < simulation.samCost) return;
    setPlacement(placingBuilding === 'sam' ? null : 'sam');
  });
  map.addEventListener('pointermove', event => {
    if (!placingBuilding) return;
    const point = mapPoint(event);
    radarPreview.setAttribute('visibility', 'visible');
    radarPreview.classList.toggle('invalid', !canPlaceBuilding(point));
    radarPreview.setAttribute('transform', `translate(${point.x} ${point.y})`);
  });
  map.addEventListener('pointerleave', () => radarPreview.setAttribute('visibility', 'hidden'));
  map.addEventListener('click', event => {
    if (!placingBuilding) return;
    const point = mapPoint(event);
    if (!canPlaceBuilding(point)) return;
    advance(performance.now());
    const placed = placingBuilding === 'radar' ? simulation.placeRadar(point.x, point.y) : simulation.placeSam(point.x, point.y);
    if (placed) addBuildingDisplay(placingBuilding === 'radar' ? simulation.radars.at(-1) : simulation.samSites.at(-1));
    setPlacement(null);
  });
  speedButtons.forEach(button => button.addEventListener('click', () => setSpeed(Number(button.dataset.speed))));
  document.querySelector('#raid-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.querySelector('#uav-count');
    if (!input.reportValidity()) return;
    advance(performance.now());
    const raid = simulation.spawnRaid(input.value === '' ? undefined : Number(input.value));
    document.querySelector('#debug-result').textContent = raid
      ? `${raid.count} UAV${raid.count === 1 ? '' : 's'} · Warning from ${raid.direction} · Arrival in ${raid.warningSeconds}s · Target: ${raid.target.name}`
      : simulation.spawnError;
    render();
  });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && placingBuilding) {
      event.preventDefault();
      setPlacement(null);
      return;
    }
    if (event.key.toLowerCase() === 'd') {
      event.preventDefault();
      if (!event.repeat) {
        debugPanel.hidden = !debugPanel.hidden;
        if (debugPanel.hidden && debugPanel.contains(document.activeElement)) document.activeElement.blur();
      }
      return;
    }
    if (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    const shortcutSpeed = { '1': 1, '2': 3, '3': 5 }[event.key];
    if (event.code !== 'Space' && shortcutSpeed === undefined) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Space') togglePause();
    else setSpeed(shortcutSpeed);
  });
  const performanceDisplay = document.querySelector('#debug-performance');
  let sampleStart = performance.now();
  let sampleFrames = 0;
  let sampleWork = 0;
  function frame(now) {
    const workStart = performance.now();
    // Use the same clock as input handlers; frame timestamps can precede them.
    advance(workStart);
    render();
    sampleWork += performance.now() - workStart;
    sampleFrames++;
    if (now - sampleStart >= 500) {
      if (!debugPanel.hidden) {
        const fps = Math.round(sampleFrames * 1000 / (now - sampleStart));
        performanceDisplay.textContent = `${fps} FPS · ${(sampleWork / sampleFrames).toFixed(1)} ms update · ${simulation.activeUnitCount}/${simulation.maxUavs} UAVs · ${simulation.raids.length}/${simulation.maxRaids} raids`;
      }
      sampleStart = now;
      sampleFrames = 0;
      sampleWork = 0;
    }
    requestAnimationFrame(frame);
  }
  render();
  requestAnimationFrame(frame);
})();
