/* Interactive quad-dominant mesh viewer for the QuadLink project page.
   Renders each OBJ asset as a shaded surface plus a wireframe that is built
   directly from the face loops, so the displayed topology is the real
   quad/triangle layout instead of a triangulated diagonal soup. */

(function () {
  var MODELS = [];
  for (var i = 1; i <= 13; i++) {
    MODELS.push({
      id: i,
      label: 'Asset ' + String(i).padStart(2, '0'),
      url: 'static/3d_assets/' + i + '.obj'
    });
  }

  var host = document.getElementById('quad-viewer-canvas');
  var statusEl = document.getElementById('quad-viewer-status');
  var pillsHost = document.getElementById('quad-mesh-pills');
  var statsHost = document.getElementById('quad-mesh-stats');
  var nameEl = document.getElementById('quad-mesh-name');

  if (!host || typeof THREE === 'undefined' || !THREE.OrbitControls) {
    if (statusEl) {
      statusEl.textContent = 'Viewer unavailable (three.js failed to load).';
    }
    return;
  }

  /* ---------------------------------------------------------------- three */

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(2.3, 1.6, 2.9);

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = 'quad-viewer-surface';
  host.appendChild(renderer.domElement);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.85;
  controls.minDistance = 1.1;
  controls.maxDistance = 12;
  controls.autoRotateSpeed = 1.1;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2c38, 0.65));
  var key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(2.4, 3.2, 3.6);
  scene.add(key);
  var rim = new THREE.DirectionalLight(0x61c2f3, 0.35);
  rim.position.set(-3, -1.2, -2.4);
  scene.add(rim);
  var fill = new THREE.DirectionalLight(0xae71e8, 0.22);
  fill.position.set(-2, 2, 2.5);
  scene.add(fill);

  var surfaceMat = new THREE.MeshStandardMaterial({
    color: 0xd8dbe6,
    roughness: 0.44,
    metalness: 0.06,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  var wireMat = new THREE.LineBasicMaterial({
    color: 0x50d2a2,
    transparent: true,
    opacity: 0.95
  });

  var group = new THREE.Group();
  scene.add(group);
  var surfaceMesh = null;
  var wireMesh = null;
  var viewMode = 'both';

  /* ------------------------------------------------------------ obj parser */

  function parseObj(text) {
    var positions = [];
    var faces = [];
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      var t = raw.split(/\s+/);
      if (t[0] === 'v') {
        positions.push(parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3]));
      } else if (t[0] === 'f') {
        var idx = [];
        for (var j = 1; j < t.length; j++) {
          var v = parseInt(t[j].split('/')[0], 10);
          if (!isNaN(v)) idx.push(v - 1);
        }
        if (idx.length >= 3) faces.push(idx);
      }
    }
    return { positions: positions, faces: faces };
  }

  function buildSurfaceGeometry(data) {
    var tri = [];
    for (var i = 0; i < data.faces.length; i++) {
      var f = data.faces[i];
      for (var j = 1; j < f.length - 1; j++) {
        pushVertex(tri, data.positions, f[0]);
        pushVertex(tri, data.positions, f[j]);
        pushVertex(tri, data.positions, f[j + 1]);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function pushVertex(out, positions, index) {
    out.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
  }

  // Centers the geometry at the origin and scales its largest dimension to 2.
  // Returns the transform so the wireframe can reuse exactly the same one.
  function fitTransform(geo) {
    geo.computeBoundingBox();
    var box = geo.boundingBox;
    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var s = 2 / (Math.max(size.x, size.y, size.z) || 1);
    applyTransform(geo, center, s);
    return { center: center, scale: s };
  }

  function applyTransform(geo, center, s) {
    geo.translate(-center.x, -center.y, -center.z);
    geo.scale(s, s, s);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }

  // Edge wireframe taken from the face loops: consecutive vertices of every
  // face, de-duplicated, so quads stay quads.
  function buildWireGeometry(data) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < data.faces.length; i++) {
      var f = data.faces[i];
      for (var j = 0; j < f.length; j++) {
        var a = f[j];
        var b = f[(j + 1) % f.length];
        var k = a < b ? a + '_' + b : b + '_' + a;
        if (seen[k]) continue;
        seen[k] = true;
        pushVertex(out, data.positions, a);
        pushVertex(out, data.positions, b);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return geo;
  }

  /* ------------------------------------------------------------- rendering */

  function clearGroup() {
    if (surfaceMesh) {
      group.remove(surfaceMesh);
      surfaceMesh.geometry.dispose();
      surfaceMesh = null;
    }
    if (wireMesh) {
      group.remove(wireMesh);
      wireMesh.geometry.dispose();
      wireMesh = null;
    }
  }

  function applyViewMode() {
    if (surfaceMesh) surfaceMesh.visible = viewMode !== 'wireframe';
    if (wireMesh) {
      wireMesh.visible = viewMode !== 'shaded';
      wireMat.color.set(viewMode === 'wireframe' ? 0x7de3bf : 0x50d2a2);
      wireMat.opacity = viewMode === 'wireframe' ? 1 : 0.95;
    }
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.hidden = !text;
    statusEl.classList.toggle('is-error', !!isError);
  }

  function updateStats(data) {
    if (!statsHost) return;
    var quads = 0;
    var tris = 0;
    var other = 0;
    for (var i = 0; i < data.faces.length; i++) {
      var n = data.faces[i].length;
      if (n === 4) quads++;
      else if (n === 3) tris++;
      else other++;
    }
    var total = quads + tris + other;
    var ratio = total ? (quads / total) * 100 : 0;
    var rows = [
      ['Vertices', data.positions.length / 3],
      ['Faces', total],
      ['Quads', quads],
      ['Triangles', tris]
    ];
    if (other) rows.push(['N-gons', other]);
    rows.push(['Quad ratio', ratio.toFixed(1) + '%']);

    statsHost.innerHTML = rows
      .map(function (r) {
        return '<li>' + r[0] + '<small>' + formatNumber(r[1]) + '</small></li>';
      })
      .join('');
  }

  function formatNumber(n) {
    return typeof n === 'number' ? n.toLocaleString('en-US') : String(n);
  }

  function loadModel(model) {
    setStatus('Loading ' + model.label + '…');
    fetch(model.url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var data = parseObj(text);
        if (!data.faces.length) throw new Error('No faces found');

        var surfaceGeo = buildSurfaceGeometry(data);
        var wireGeo = buildWireGeometry(data);
        var t = fitTransform(surfaceGeo);
        applyTransform(wireGeo, t.center, t.scale);

        clearGroup();
        surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
        wireMesh = new THREE.LineSegments(wireGeo, wireMat);
        group.add(surfaceMesh);
        group.add(wireMesh);

        resetView();
        applyViewMode();
        updateStats(data);
        if (nameEl) nameEl.textContent = model.label;
        setStatus('');
      })
      .catch(function (err) {
        setStatus('Failed to load ' + model.label + ' (' + err.message + ').', true);
      });
  }

  function resetView() {
    var radius = 1.4;
    if (surfaceMesh) {
      surfaceMesh.geometry.computeBoundingSphere();
      radius = surfaceMesh.geometry.boundingSphere.radius || 1.4;
    }
    var dist = radius * 2.6;
    camera.position.set(dist * 0.62, dist * 0.44, dist * 0.78);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }

  /* ------------------------------------------------------------------- ui */

  function buildPills() {
    if (!pillsHost) return;
    pillsHost.innerHTML = MODELS.map(function (m, i) {
      return (
        '<button type="button" class="mesh-thumbnail" data-index="' + i + '"' +
        ' aria-pressed="' + (i === 0) + '" title="' + m.label + '">' +
        '<img src="static/3d_assets/thumbs/' + m.id + '.png" alt="' + m.label + '"' +
        ' loading="lazy" decoding="async"></button>'
      );
    }).join('');
    pillsHost.addEventListener('click', function (e) {
      var btn = e.target.closest('.mesh-thumbnail');
      if (!btn) return;
      Array.prototype.forEach.call(pillsHost.children, function (c) {
        c.setAttribute('aria-pressed', String(c === btn));
      });
      loadModel(MODELS[parseInt(btn.dataset.index, 10)]);
    });
  }

  function bindModes() {
    var inputs = document.querySelectorAll('input[name="quad-view-mode"]');
    Array.prototype.forEach.call(inputs, function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        viewMode = input.value;
        Array.prototype.forEach.call(inputs, function (other) {
          var label = other.closest('label');
          if (label) label.classList.toggle('is-selected', other === input);
        });
        applyViewMode();
      });
    });
  }

  function bindAutoRotate() {
    var btn = document.getElementById('quad-autorotate');
    if (!btn) return;
    btn.addEventListener('click', function () {
      controls.autoRotate = !controls.autoRotate;
      btn.setAttribute('aria-pressed', String(controls.autoRotate));
    });
  }

  function resize() {
    var w = host.clientWidth || 1;
    var h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(host);
  }
  window.addEventListener('resize', resize);

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  buildPills();
  bindModes();
  bindAutoRotate();
  resize();
  loadModel(MODELS[0]);
})();
