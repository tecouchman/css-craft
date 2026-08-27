const blockTypes = [{}, { texture: 'grass' }, { texture: 'dirt' }, { texture: 'gravel' }, { texture: 'stone' }];
const faceNames = ['tp', 'bm', 'rt', 'lt', 'bk', 'ft'];

function renderChunk(level, chunk, animate = false) {
	const worldPos = level.chunkToWorldPosition(chunk.x, chunk.y, chunk.z);
	const mesh = document.createElement('div');
	const fragment = document.createDocumentFragment();
	chunk.mesh = mesh;

	for (let face = 0; face < 6; face++) appendGreedyFaces(fragment, level, chunk, face);

	mesh.append(fragment);
	mesh.classList.add('chunk');
	if (animate) mesh.classList.add('move-in');
	mesh.style.transform = `translate3d(${worldPos.x * level.tileSize}px,${worldPos.y * level.tileSize}px,${worldPos.z * level.tileSize}px)`;
	appendInOrder(level.scene, mesh, chunk);
}

// Overscanned faces from neighbouring chunks overlap slightly in the same
// plane, and browsers resolve exactly-coplanar faces by DOM paint order.
// Keeping chunks sorted by coordinates makes that order independent of when
// a chunk happens to (re)render; plain append would let a rebuilt chunk jump
// above neighbours it previously sat below, flickering the overlap seams.
function appendInOrder(scene, mesh, chunk) {
	mesh.dataset.cx = chunk.x;
	mesh.dataset.cy = chunk.y;
	mesh.dataset.cz = chunk.z;
	let before = null;
	for (const sibling of scene.children) {
		const d = sibling.dataset;
		if ((d.cx - chunk.x || d.cy - chunk.y || d.cz - chunk.z) > 0) {
			before = sibling;
			break;
		}
	}
	scene.insertBefore(mesh, before);
}

function appendGreedyFaces(fragment, level, chunk, face) {
	const d = level.chunkDimensions;
	const axes = face < 2 ? ['y', 'x', 'z'] : face < 4 ? ['x', 'z', 'y'] : ['z', 'x', 'y'];
	const lengths = { x: d.width, y: d.height, z: d.depth };
	const [sliceAxis, uAxis, vAxis] = axes;

	for (let slice = 0; slice < lengths[sliceAxis]; slice++) {
		const rows = Array.from({ length: lengths[vAxis] }, () => Array(lengths[uAxis]).fill(0));
		for (let v = 0; v < lengths[vAxis]; v++) for (let u = 0; u < lengths[uAxis]; u++) {
			const p = { x: 0, y: 0, z: 0 };
			p[sliceAxis] = slice; p[uAxis] = u; p[vAxis] = v;
			const id = level.getChunkBlock(chunk, p.x, p.y, p.z);
			if (id && neighbourIsEmpty(level, chunk, p, face)) rows[v][u] = id;
		}

		for (let v = 0; v < rows.length; v++) for (let u = 0; u < rows[v].length; u++) {
			const id = rows[v][u];
			if (!id) continue;
			let width = 1;
			while (u + width < rows[v].length && rows[v][u + width] === id) width++;
			let height = 1, matches = true;
			while (v + height < rows.length && matches) {
				for (let i = 0; i < width; i++) if (rows[v + height][u + i] !== id) { matches = false; break; }
				if (matches) height++;
			}
			for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) rows[v + j][u + i] = 0;
			const p = { x: 0, y: 0, z: 0 };
			p[sliceAxis] = slice; p[uAxis] = u; p[vAxis] = v;
			fragment.append(makeFace(level.tileSize, p, face, id, width, height));
		}
	}
}

function neighbourIsEmpty(level, chunk, p, face) {
	const offsets = [[0,-1,0],[0,1,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1]];
	const o = offsets[face];
	return level.getChunkBlock(chunk, p.x + o[0], p.y + o[1], p.z + o[2]) === 0;
}

function makeFace(size, p, face, id, width, height) {
	const element = document.createElement('div');
	const texture = blockTypes[id].texture;
	element.classList.add('face', 'greedy-face', faceNames[face], texture);
	element.dataset.tile = faceNames[face];
	// The half-pixel overscan hides antialiasing seams where faces meet. It
	// makes coplanar quads overlap slightly; browsers paint exactly-coplanar
	// faces in DOM order, and appendInOrder keeps that order fixed, so the
	// overlap resolves the same way every frame. No depth offsets: any lift
	// off the shared plane opens visible gaps at grazing view angles.
	element.style.width = `${width * size + .5}px`;
	element.style.height = `${height * size + .5}px`;
	const x = p.x * size, y = p.y * size, z = p.z * size;
	const centreU = ((face < 2 ? height : width) - 1) * size / 2;
	const transforms = [
		`translate3d(${x}px,${y}px,${z + centreU}px) rotateX(90deg) translateY(-50%)`,
		`translate3d(${x}px,${y + size}px,${z + centreU}px) rotateX(-90deg) translateY(-50%)`,
		`translate3d(${x}px,${y}px,${z + centreU}px) rotateY(-90deg) translateX(-50%)`,
		`translate3d(${x + size}px,${y}px,${z + centreU}px) rotateY(90deg) translateX(-50%)`,
		`translate3d(${x + width * size}px,${y}px,${z - size / 2}px) rotateY(180deg)`,
		`translate3d(${x}px,${y}px,${z + size / 2}px)`
	];
	element.style.setProperty('transform', transforms[face], 'important');
	return element;
}

export default renderChunk;
