import * as THREE from 'three';

let renderer, scene, camera, materials;
const textureLoader = new THREE.TextureLoader();
const atlasNames = ['grass_side', 'dirt', 'gravel', 'stone'];
const faceTile = [0, 1, 3, 1, 2, 0];

function makeTexture(path) {
	const texture = textureLoader.load(path);
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function init(game) {
	if (renderer) return;
	renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.domElement.id = 'three-canvas';
	game.append(renderer.domElement);
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x73b9ee);
	camera = new THREE.PerspectiveCamera(90, 1, 10, 20000);
	camera.rotation.order = 'YXZ';
	materials = atlasNames.map(name => new THREE.MeshBasicMaterial({ map: makeTexture(`images/block_textures/${name}.png`), side: THREE.DoubleSide }));
	materials.push(new THREE.MeshBasicMaterial({ map: makeTexture('images/block_textures/grass_top.png'), side: THREE.DoubleSide }));
	resize();
}

function resize() {
	if (!renderer) return;
	const width = renderer.domElement.parentElement.clientWidth;
	const height = renderer.domElement.parentElement.clientHeight;
	renderer.setSize(width, height, false);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
}

function renderChunk(level, chunk) {
	const buckets = Array.from({ length: materials.length }, () => ({ positions: [], uvs: [] }));
	const d = level.chunkDimensions, size = level.tileSize;
	for (let x = 0; x < d.width; x++) for (let y = 0; y < d.height; y++) for (let z = 0; z < d.depth; z++) {
		const id = level.getChunkBlock(chunk, x, y, z);
		if (!id) continue;
		const offsets = [[0,-1,0],[0,1,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1]];
		for (let face = 0; face < 6; face++) {
			const o = offsets[face];
			if (level.getChunkBlock(chunk, x + o[0], y + o[1], z + o[2])) continue;
			let material = id - 1;
			if (id === 1 && face === 0) material = 4;
			if (id === 1 && face === 1) material = 1;
			appendQuad(buckets[material], x * size, y * size, z * size, size, face, material === 4 ? -1 : faceTile[face]);
		}
	}

	const positions = [], uvs = [], geometry = new THREE.BufferGeometry();
	let vertexStart = 0;
	for (let material = 0; material < buckets.length; material++) {
		const bucket = buckets[material];
		if (!bucket.positions.length) continue;
		positions.push(...bucket.positions); uvs.push(...bucket.uvs);
		geometry.addGroup(vertexStart, bucket.positions.length / 3, material);
		vertexStart += bucket.positions.length / 3;
	}
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	const mesh = new THREE.Mesh(geometry, materials);
	const world = level.chunkToWorldPosition(chunk.x, chunk.y, chunk.z);
	// CSSCraft's world Y increases downward. Flip the chunk geometry while
	// keeping Three.js's conventional upward camera coordinate system.
	mesh.scale.y = -1;
	mesh.position.set(world.x * size, -world.y * size, world.z * size);
	chunk.mesh = mesh;
	scene.add(mesh);
}

function appendQuad(bucket, x, y, z, s, face, tile) {
	const corners = [
		[[x,y,z],[x+s,y,z],[x+s,y,z+s],[x,y,z+s]],
		[[x,y+s,z+s],[x+s,y+s,z+s],[x+s,y+s,z],[x,y+s,z]],
		[[x,y,z],[x,y,z+s],[x,y+s,z+s],[x,y+s,z]],
		[[x+s,y,z+s],[x+s,y,z],[x+s,y+s,z],[x+s,y+s,z+s]],
		[[x+s,y,z],[x,y,z],[x,y+s,z],[x+s,y+s,z]],
		[[x,y,z+s],[x+s,y,z+s],[x+s,y+s,z+s],[x,y+s,z+s]]
	][face];
	const order = [0,1,2,0,2,3];
	for (const i of order) bucket.positions.push(...corners[i]);
	// Atlas textures contain four horizontal tiles; grass_top is a standalone
	// square and therefore uses the complete UV range.
	const u0 = tile < 0 ? 0 : tile / 4;
	const u1 = tile < 0 ? 1 : (tile + 1) / 4;
	const quadUvs = [[u0,1],[u1,1],[u1,0],[u0,0]];
	for (const i of order) bucket.uvs.push(...quadUvs[i]);
}

function update(player, tileSize) {
	if (!renderer) return;
	if (renderer.domElement.width !== renderer.domElement.clientWidth * renderer.getPixelRatio() || renderer.domElement.height !== renderer.domElement.clientHeight * renderer.getPixelRatio()) resize();
	camera.position.set(player.worldPosition.x + tileSize / 2, player.worldPosition.y, -player.worldPosition.z + tileSize / 2);
	camera.rotation.x = THREE.MathUtils.degToRad(-player.rotation.x);
	camera.rotation.y = THREE.MathUtils.degToRad(-player.rotation.y);
	renderer.render(scene, camera);
}

function removeChunk(chunk) {
	if (!chunk.mesh) return;
	scene.remove(chunk.mesh);
	chunk.mesh.geometry?.dispose();
	chunk.mesh = null;
}

function setVisible(visible) {
	if (!renderer) return;
	// WebGLRenderer assigns display:block inline, which wins over the browser's
	// normal [hidden] presentation in some Chromium builds. Set display
	// explicitly so the canvas cannot continue covering the CSS scene.
	renderer.domElement.hidden = !visible;
	renderer.domElement.style.display = visible ? 'block' : 'none';
}

export { init, renderChunk, update, removeChunk, setVisible };
