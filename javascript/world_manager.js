import generateChunk from "./terrain_generator.js";
import renderChunk from "./renderer.js";

let _camera, _tileSize, _rotation, _scene, level;

function init(camera, tileSize, scene, rotation) {
	_camera = camera;
	_tileSize = tileSize;
	_scene = scene;
	_rotation = rotation;
	level = new Level(_scene, _tileSize, chunkDimensions);
}

let generateDistance = { x: 5, y: 2, z: 5 };
let rendererDistances = { css: 5, three: 15 };
// Keep the render sphere biased toward the view direction, but leave enough
// terrain behind/below the player that its rear edge is not visible.
const renderCentreBias = 1.75;
let spawnOffset = Math.floor(generateDistance.x * renderCentreBias);
let lastRender = 0.1;
let lastChunkKey = '';
let renderRevision = 0;
let appliedRenderRevision = -1;
let hasRenderedInitialWorld = false;
let rendererMode = 'css';
let threeRenderer = null;

noise.seed(24601);

const buildDelay = 0.1;

let chunkDimensions = {
	height: 5,
	width: 3,
	depth: 3
};

function getRenderDistance() {
	return generateDistance.x;
}

function setRenderDistance(distance) {
	generateDistance.x = generateDistance.z = distance;
	spawnOffset = Math.floor(distance * renderCentreBias);
	rendererDistances[rendererMode] = distance;
	renderRevision++;
}

/* Object that holds the level data */
function Level(scene, tileSize, chunkDimensions) {
	this.scene = scene;
	this.tileSize = tileSize;
	this.chunkDimensions = chunkDimensions;
	this.data = {};
	this.getChunk = function (x, y, z) {
		return level.data[this.generateKey(x, y, z)];
	}
	this.generateKey = function (x, y, z) {
		return x + '_' + y + '_' + z;
	}
	this.worldToLocalPosition = function (worldX, worldY, worldZ) {
		let chunkPos = {
			x: ((worldX % this.chunkDimensions.width) +
				this.chunkDimensions.width) % this.chunkDimensions.width,
			y: ((worldY % chunkDimensions.height) +
				this.chunkDimensions.height) % this.chunkDimensions.height,
			z: ((worldZ % chunkDimensions.depth) +
				this.chunkDimensions.depth) % this.chunkDimensions.depth
		}

		return chunkPos;
	}
	this.worldCubeToChunkPosition = function (worldX, worldY, worldZ) {
		let chunkPos = {
			x: Math.floor(worldX / this.chunkDimensions.width),
			y: Math.floor(worldY / this.chunkDimensions.height),
			z: Math.floor(worldZ / this.chunkDimensions.depth)
		}

		return chunkPos;
	}
	this.chunkToWorldPosition = function (chunkX, chunkY, chunkZ) {
		let worldPos = {
			x: chunkX * this.chunkDimensions.width,
			y: chunkY * this.chunkDimensions.height,
			z: chunkZ * this.chunkDimensions.depth
		}

		return worldPos;
	}
	this.getChunkBlock = function (chunk, x, y, z) {

		if (!chunk || !chunk.data)
			return 0;

		if (x < 0 || y < 0 || z < 0 || x >= this.chunkDimensions.width || y >= this.chunkDimensions.height || z >= this.chunkDimensions.depth) {
			return this.getBlock(chunk.x * this.chunkDimensions.width + x, chunk.y * this.chunkDimensions.height + y, chunk.z * this.chunkDimensions.depth + z);
		}
		return chunk.data[x][y][z] || 0;
	}
	this.getBlock = function (worldX, worldY, worldZ) {

		let chunkPos = this.worldCubeToChunkPosition(worldX, worldY, worldZ);
		let chunk = this.getChunk(chunkPos.x, chunkPos.y, chunkPos.z);

		if (!chunk || !chunk.data)
			return 0;

		let pos = this.worldToLocalPosition(worldX, worldY, worldZ);

		return chunk.data[pos.x][pos.y][pos.z];
	}
};


/* Builds the divs to display the level in 3D */
function render() {
	let chunkPos = level.worldCubeToChunkPosition(_camera.spawnCubePosition.x, _camera.spawnCubePosition.y, _camera.spawnCubePosition.z);
	let chunk = null;
	let chunksToRender = [];
	for (let x = chunkPos.x - generateDistance.x; x <= chunkPos.x + generateDistance.x; x++) {
		for (let y = chunkPos.y - generateDistance.y; y <= chunkPos.y + generateDistance.y; y++) {
			for (let z = chunkPos.z - generateDistance.z; z <= chunkPos.z + generateDistance.z; z++) {
				// A draw distance is radial in practice. The old square window rendered
				// up to 41% farther away at its corners than the selected distance.
				if (!isWithinHorizontalDistance(x, z, chunkPos, generateDistance.x))
					continue;
				chunk = level.getChunk(x, y, z);
				if (chunk && !chunk.mesh) {
					chunksToRender.push(chunk);
				}
			}
		}
	}

	// A few chunks entering at the edge can animate cheaply. Animating the whole
	// initial world or a large draw-distance expansion creates hundreds of
	// simultaneous compositor animations and is considerably more expensive.
	let animate = hasRenderedInitialWorld && chunksToRender.length <= 48;
	for (let chunkToRender of chunksToRender) {
		if (rendererMode === 'three') threeRenderer.renderChunk(level, chunkToRender);
		else {
			renderChunk(level, chunkToRender, animate);
			// A fresh mesh starts visible; keep the culling state in sync so
			// the next updateChunkVisibility pass can hide it if needed.
			chunkToRender.meshHidden = false;
		}
	}
	hasRenderedInitialWorld = true;
}

// Matches the fixed `perspective` on #game in the stylesheet.
const cssPerspective = 500;
// Half the diagonal of a chunk (3x5x3 blocks at 100px), plus slack for the
// half-tile offset between camera and scene space.
const chunkBoundingRadius = 425;
const degToRad = Math.PI / 180;

// Every face div is its own compositor layer, and layers the camera cannot
// see still hold GPU texture memory. Once the whole render sphere is live the
// compositor starts shedding textures under pressure, which shows up as faces
// shimmering in and out while moving. Hiding chunks outside the view frustum
// keeps only the layers that can actually appear on screen.
function updateChunkVisibility() {
	let rx = _camera.rotation.x * degToRad;
	let ry = _camera.rotation.y * degToRad;
	let sinRx = Math.sin(rx), cosRx = Math.cos(rx);
	let sinRy = Math.sin(ry), cosRy = Math.cos(ry);

	// Slopes of the frustum's side planes, widened so a chunk's bounding
	// sphere must be fully outside the screen before it is hidden.
	let slopeX = (window.innerWidth / 2) / cssPerspective;
	let slopeY = (window.innerHeight / 2) / cssPerspective;
	let marginX = chunkBoundingRadius * Math.sqrt(1 + slopeX * slopeX);
	let marginY = chunkBoundingRadius * Math.sqrt(1 + slopeY * slopeY);

	for (let chunk of Object.values(level.data)) {
		if (!chunk.mesh) continue;

		// Chunk centre relative to the camera, in scene pixels.
		let px = (chunk.x + 0.5) * chunkDimensions.width * _tileSize - _camera.worldPosition.x;
		let py = (chunk.y + 0.5) * chunkDimensions.height * _tileSize + _camera.worldPosition.y;
		let pz = (chunk.z + 0.5) * chunkDimensions.depth * _tileSize + _camera.worldPosition.z;

		// Rotate into view space (the inverse of the #rotation transform).
		let viewX = px * cosRy + pz * sinRy;
		let rotatedZ = pz * cosRy - px * sinRy;
		let viewY = py * cosRx + rotatedZ * sinRx;
		let depth = py * sinRx - rotatedZ * cosRx;

		let hidden = depth < -chunkBoundingRadius ||
			Math.abs(viewX) > slopeX * depth + marginX ||
			Math.abs(viewY) > slopeY * depth + marginY;

		if (chunk.meshHidden !== hidden) {
			chunk.meshHidden = hidden;
			chunk.mesh.style.visibility = hidden ? 'hidden' : '';
		}
	}
}

function isWithinHorizontalDistance(x, z, centre, distance) {
	let dx = x - centre.x;
	let dz = z - centre.z;
	return dx * dx + dz * dz <= distance * distance;
}

function updateLevel(delta) {
	// map positions on x axis are inverted, i.e. moving forward into map results in negative position
	// so to calculate map x coord need to negate the player position. Also offset by the size of a tile
	// to ensure the user feels like the are directly on the tile.
	let xPos = 0 - (_camera.worldPosition.x - (_tileSize / 2));
	let zPos = _camera.worldPosition.z + (_tileSize / 2);

	_scene.style.transform = 'translate3d(' + xPos + 'px, ' + _camera.worldPosition.y + 'px, ' + zPos + 'px)';

	// Set the world _rotation
	_rotation.style.transform = 'translate3d(0, 0, 500px) rotateX(-' + (_camera.rotation.x + 360) + 'deg) rotateY(' + _camera.rotation.y + 'deg) rotateZ(0deg)';
	if (rendererMode === 'three') threeRenderer.update(_camera, _tileSize);
	else updateChunkVisibility();

	let playerPos = _camera.spawnCubePosition;

	if (!isNaN(delta))
		lastRender += delta;

	let currentChunk = level.worldCubeToChunkPosition(_camera.spawnCubePosition.x, _camera.spawnCubePosition.y, _camera.spawnCubePosition.z);
	let currentChunkKey = level.generateKey(currentChunk.x, currentChunk.y, currentChunk.z);

	if (lastRender > buildDelay && (currentChunkKey !== lastChunkKey || appliedRenderRevision !== renderRevision)) {

		let currChunk = currentChunk;
		lastChunkKey = currentChunkKey;
		appliedRenderRevision = renderRevision;

		for (let chunk of Object.values(level.data)) {
			
			if (chunk.y < currChunk.y - generateDistance.y - 2 ||
				chunk.y > currChunk.y + generateDistance.y + 2 ||
				!isWithinHorizontalDistance(chunk.x, chunk.z, currChunk, generateDistance.x + 2)) {

				if (rendererMode === 'three') threeRenderer.removeChunk(chunk);
				else chunk.mesh?.remove();
				let key = level.generateKey(chunk.x, chunk.y, chunk.z);
				delete level.data[key];
			}
		}

		for (let chunkX = currChunk.x - generateDistance.x - 1; chunkX <= currChunk.x + generateDistance.x + 1; chunkX++) {
			for (let chunkY = currChunk.y - generateDistance.y - 1; chunkY <= currChunk.y + generateDistance.y + 1; chunkY++) {
				for (let chunkZ = currChunk.z - generateDistance.z - 1; chunkZ <= currChunk.z + generateDistance.z + 1; chunkZ++) {
					if (!isWithinHorizontalDistance(chunkX, chunkZ, currChunk, generateDistance.x + 1))
						continue;
					let key = level.generateKey(chunkX, chunkY, chunkZ);
					if (!(key in level.data)) {
						let chunk = generateChunk(chunkX, chunkY, chunkZ, chunkDimensions);
						level.data[key] = chunk;
					}
				}
			}
		}

		render();
		lastRender = 0;
	}
}

async function setRendererMode(mode) {
	if (mode === rendererMode) return;
	if (mode === 'three' && !threeRenderer) {
		threeRenderer = await import('./renderer_three.js');
		threeRenderer.init(document.getElementById('game'));
	}
	for (let chunk of Object.values(level.data)) {
		if (rendererMode === 'three') threeRenderer.removeChunk(chunk);
		else chunk.mesh?.remove();
		chunk.mesh = null;
	}
	rendererMode = mode;
	generateDistance.x = generateDistance.z = rendererDistances[mode];
	spawnOffset = Math.floor(generateDistance.x * renderCentreBias);
	_scene.hidden = mode !== 'css';
	if (threeRenderer) threeRenderer.setVisible(mode === 'three');
	renderRevision++;
	// Switching renderers invalidates every visual mesh. Rebuild immediately;
	// otherwise a recent chunk update can leave the selected renderer blank
	// until the throttled world-maintenance interval runs again.
	render();
	lastRender = buildDelay + 1;
	lastChunkKey = '';
	// Complete generation/reconciliation as part of the switch itself. This is
	// important when animation frames are paused (background tabs) and also
	// prevents a visible blue frame while waiting for the next RAF tick.
	updateLevel(buildDelay + 1);
}


export { init, spawnOffset, updateLevel, level, generateDistance, getRenderDistance, setRenderDistance, setRendererMode };
