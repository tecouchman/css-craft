import { init as initWorldManager, spawnOffset, updateLevel, level, getRenderDistance, setRenderDistance, setRendererMode } from './world_manager.js';

const tileSize = 100;

let camera = {
	worldPosition: { x: 0, y: 200, z: 0 },
	cubePosition: { x: 0, y: 2, z: 0 },
	spawnCubePosition: { x: 0, y: 0, z: 0 },
	rotation: { x: 0, y: 0 }
};

let playerSpeed = 500;
let hasPointerLock = false;
let viewport;
let pointerLockElemn;
let demoMode = true;
let verticalSpeed = 600;
let verticalVelocity = 0;
let jumpRequested = false;
let autoJumpEnabled = true;
const jumpSpeed = 780;
const gravity = 2400;

let movement = { left: false, right: false, forward: false, backward: true };

// The CSS renderer keeps a compositor layer per face, so it hits GPU limits
// well before the Three.js renderer does.
const maxRenderDistances = { css: 10, three: 30 };

function start(isDemoMode) {
	setDemoMode(isDemoMode);

	init();
	// Start the game loop
	loop();
}

function init() {
	updateCameraCubePosition();

	viewport = document.getElementById('viewport');
	pointerLockElemn = document.getElementById('btn-pointer-lock');
	document.addEventListener('pointerlockchange', pointerLockChanged, false);

	pointerLockElemn.addEventListener('click', viewport.requestPointerLock);
	document.getElementById('overlay').addEventListener('click', viewport.requestPointerLock);

	document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

	if (viewport.requestPointerLock)
		hasPointerLock = true;

	let renderDistance = document.querySelector('#render-distance input');
	let renderDistanceLabel = document.querySelector('#render-distance label');

	renderDistance.max = maxRenderDistances.css;
	renderDistance.value = getRenderDistance();

	renderDistance.addEventListener('change', function () {
		renderDistanceLabel.textContent = renderDistance.value;
		setRenderDistance(Number(renderDistance.value));
	});

	let scene = document.getElementById('scene');
	let rotation = document.getElementById('rotation');
	let autoJump = document.getElementById('auto-jump-enabled');
	autoJump.checked = autoJumpEnabled;
	autoJump.addEventListener('change', () => autoJumpEnabled = autoJump.checked);

	initWorldManager(camera, tileSize, scene, rotation);

	document.querySelectorAll('#renderer-tabs button').forEach(button => {
		button.addEventListener('click', async () => {
			let tabs = [...document.querySelectorAll('#renderer-tabs button')];
			tabs.forEach(tab => tab.disabled = true);
			try {
				await setRendererMode(button.dataset.renderer);
				renderDistance.max = maxRenderDistances[button.dataset.renderer];
				renderDistance.value = getRenderDistance();
				renderDistanceLabel.textContent = renderDistance.value;
				tabs.forEach(tab => tab.classList.toggle('active', tab === button));
			} finally {
				tabs.forEach(tab => tab.disabled = false);
			}
		});
	});
}

function setDemoMode(isDemoMode) {
	demoMode = isDemoMode;

	let overlayClasslist = document.getElementById('overlay').classList;
	overlayClasslist.remove("visible", "hidden");
	if (demoMode)
		overlayClasslist.add("hidden");
	else
		overlayClasslist.add("visible");
}

function requestPointerLock() {
	if (hasPointerLock)
		viewport.requestPointerLock();
}

function toggleFullscreen() {

	if (document.fullscreenElement) {
		document.exitFullscreen();
	}
	else {
		viewport.requestFullscreen();
	}
}

function pointerLockChanged() {
	hasPointerLock = document.pointerLockElement != null;
	if (hasPointerLock) {
		pointerLockElemn.classList.remove("fade-in");
		pointerLockElemn.classList.add("fade-out");
	} else {
		pointerLockElemn.style.display = 'block';
		pointerLockElemn.classList.remove("fade-out");
		pointerLockElemn.classList.add("fade-in");
	}
}

document.addEventListener('keydown', function (event) {
	if (event.code === 'Space') {
		if (!event.repeat) jumpRequested = true;
		event.preventDefault();
		return;
	}
	setKeyPressed(event.code, true);
});

document.addEventListener('keyup', function (event) {
	setKeyPressed(event.code, false);
});

function setKeyPressed(keyCode, pressed) {
	switch (keyCode) {
		case 'KeyA':
		case 'ArrowLeft':
			movement.left = pressed;
			break;
		case 'KeyW':
		case 'ArrowUp':
			movement.forward = pressed;
			break;
		case 'KeyD':
		case 'ArrowRight':
			movement.right = pressed;
			break;
		case 'KeyS':
		case 'ArrowDown':
			movement.back = pressed;
			break;
	}
}

document.addEventListener('mousemove', function (event) {

	if (event.movementX || event.movementY) {
		let multiplierX = 360 / window.innerWidth;
		let mouseX = event.movementX * multiplierX;

		let multiplierY = 360 / window.innerHeight;
		let mouseY = event.movementY * multiplierY;

		if (document.pointerLockElement == null && hasPointerLock)
			return;

		// find the changes in mousex/y positions and calculate the angles of the level.
		camera.rotation.y += mouseX;

		// ensure that angle x is within bounds before allowing changes.
		if ((camera.rotation.x < 90 && mouseY > 0) || (camera.rotation.x > -90 && mouseY < 0))
			camera.rotation.x += mouseY;
	}
});

function move(x, z) {

	if (z != 0) {
		camera.worldPosition.x += z * Math.cos(math.degToRad(90 - camera.rotation.y));
		camera.worldPosition.z += z * Math.sin(math.degToRad(90 - camera.rotation.y));
	}
	else if (x != 0) {
		camera.worldPosition.x += x * Math.cos(math.degToRad(360 - camera.rotation.y));
		camera.worldPosition.z += x * Math.sin(math.degToRad(360 - camera.rotation.y));
	}
}

// Calculates the block position of the camera based on its world world position
function updateCameraCubePosition() {
	camera.cubePosition.x = Math.floor(camera.worldPosition.x / tileSize);
	camera.cubePosition.y = Math.floor(0 - camera.worldPosition.y / tileSize);
	camera.cubePosition.z = Math.floor(0 - camera.worldPosition.z / tileSize);

	camera.spawnCubePosition.x = camera.cubePosition.x + spawnOffset * Math.cos(math.degToRad(90 - camera.rotation.y));
	camera.spawnCubePosition.z = camera.cubePosition.z - spawnOffset * Math.sin(math.degToRad(90 - camera.rotation.y));
	camera.spawnCubePosition.y = camera.cubePosition.y;
}

let demoSpeed = { x: 5, z: -5 };

let previousTime;

let loop = function (timestamp) {
	if (!previousTime)
		previousTime = timestamp;

	let delta = (timestamp - previousTime) / 1000;

	update(delta);

	previousTime = timestamp;

	window.requestAnimationFrame(loop);
}

function update(delta) {
	updateCameraCubePosition();

	if (demoMode) {
		updateDemo();
	}
	else {
		// Once a higher terrain column intersects the player's lower body, pause
		// horizontal travel until auto-jump has lifted the camera clear of it.
		// This prevents the Three.js near plane from entering steep hill faces.
		let climbing = level.getBlock(camera.cubePosition.x, camera.cubePosition.y + 1, camera.cubePosition.z) > 0;
		if (!climbing) {
			let previousX = camera.worldPosition.x;
			let previousZ = camera.worldPosition.z;
			if (movement.left) move(-playerSpeed * delta, 0);
			if (movement.forward) move(0, playerSpeed * delta);
			if (movement.right) move(playerSpeed * delta, 0);
			if (movement.back) move(0, -playerSpeed * delta);

			if (!autoJumpEnabled) {
				let intendedX = camera.worldPosition.x;
				let intendedZ = camera.worldPosition.z;
				camera.worldPosition.x = previousX;
				camera.worldPosition.z = previousZ;

				// Resolve each horizontal axis independently. If one direction hits
				// terrain, the other remains free so the player slides along the edge.
				camera.worldPosition.x = intendedX;
				updateCameraCubePosition();
				if (level.getBlock(camera.cubePosition.x, camera.cubePosition.y + 1, camera.cubePosition.z) > 0)
					camera.worldPosition.x = previousX;

				camera.worldPosition.z = intendedZ;
				updateCameraCubePosition();
				if (level.getBlock(camera.cubePosition.x, camera.cubePosition.y + 1, camera.cubePosition.z) > 0)
					camera.worldPosition.z = previousZ;
			}
		}

		updateCameraCubePosition();
		updateVerticalPosition(delta);
	}

	updateLevel(delta);
}

function updateDemo() {
	window.level = level;
	let collisionY = level.getBlock(camera.cubePosition.x, camera.cubePosition.y + 4, camera.cubePosition.z) > 0;
	let inBlock = level.getBlock(camera.cubePosition.x, camera.cubePosition.y + 3, camera.cubePosition.z) > 0;
	if (inBlock) {
		camera.worldPosition.y = camera.worldPosition.y + 3;
	}
	if (!collisionY) {
		camera.worldPosition.y = camera.worldPosition.y - 3;
	}

	let anglularChange = noise.perlin2(camera.worldPosition.x * 0.0008, camera.worldPosition.y * 0.0008);
	camera.worldPosition.x += demoSpeed.x + anglularChange;
	camera.worldPosition.z += demoSpeed.z - anglularChange;
	camera.rotation = { x: 30, y: 135 + anglularChange * 50 };
}

let math = {
	degToRad: function (deg) {
		return deg * (Math.PI / 180);
	},
	pointOnCircle: function (radius, angle) {
		var z = radius * Math.cos(math.degToRad(angle));
		var x = radius * Math.sin(math.degToRad(angle));
		return { x: x, z: z };
	},
	maxRad: Math.PI * 2,
	wrapRad: function (rad) {
		if (rad > math.maxRad)
			rad -= math.maxRad;
		else if (rad < 0)
			rad += math.maxRad;
		return rad;
	},
	lerp: function (from, to, t) {
		return (1 - t) * from + t * to;
	}
}

export {
	tileSize,
	start,
	camera,
	toggleFullscreen,
	requestPointerLock,
	setDemoMode,
	math
}

function updateVerticalPosition(delta) {
	let groundY = null;
	for (let y = camera.cubePosition.y + 1; y <= camera.cubePosition.y + 5; y++) {
		if (level.getBlock(camera.cubePosition.x, y, camera.cubePosition.z) > 0) {
			groundY = y;
			break;
		}
	}
	if (groundY === null) {
		verticalVelocity -= gravity * delta;
		camera.worldPosition.y += verticalVelocity * delta;
		jumpRequested = false;
		return;
	}

	let targetY = (2 - groundY) * tileSize;
	let difference = targetY - camera.worldPosition.y;

	if (jumpRequested) {
		if (Math.abs(difference) < 1 && verticalVelocity === 0)
			verticalVelocity = jumpSpeed;
		jumpRequested = false;
	}

	if (verticalVelocity !== 0) {
		verticalVelocity -= gravity * delta;
		let nextY = camera.worldPosition.y + verticalVelocity * delta;
		if (verticalVelocity < 0 && nextY <= targetY) {
			camera.worldPosition.y = targetY;
			verticalVelocity = 0;
		} else {
			camera.worldPosition.y = nextY;
		}
		return;
	}

	let step = verticalSpeed * (difference > 0 ? 2 : 1) * delta;
	camera.worldPosition.y += Math.sign(difference) * Math.min(Math.abs(difference), step);
}
