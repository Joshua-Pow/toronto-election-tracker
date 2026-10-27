import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "tracker-assets");

const HEADERS = `/*
	X-Content-Type-Options: nosniff
	Referrer-Policy: strict-origin-when-cross-origin
	X-Frame-Options: DENY
	Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://server.arcgisonline.com; connect-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
	Cross-Origin-Opener-Policy: same-origin
	Cross-Origin-Resource-Policy: same-origin
	Permissions-Policy: camera=(), microphone=(), geolocation=()
	X-Robots-Tag: noindex, nofollow, noarchive

/vendor/*
	Cache-Control: public, max-age=3600

/wards.geojson
	Cache-Control: public, max-age=3600
`;

function copyTree(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
		if (ent.name.startsWith(".")) continue;
		const from = path.join(src, ent.name);
		const to = path.join(dest, ent.name);
		if (ent.isSymbolicLink() || !ent.isFile() && !ent.isDirectory()) continue;
		if (ent.isDirectory()) copyTree(from, to);
		else fs.copyFileSync(from, to);
	}
}

export function stageTrackerAssets() {
	fs.rmSync(out, { recursive: true, force: true });
	copyTree(path.join(root, "public"), out);

	const leafletDir = path.join(root, "node_modules/leaflet/dist");
	const leafletOut = path.join(out, "vendor/leaflet");
	fs.mkdirSync(path.join(leafletOut, "images"), { recursive: true });
	fs.copyFileSync(path.join(leafletDir, "leaflet.js"), path.join(leafletOut, "leaflet.js"));
	fs.copyFileSync(path.join(leafletDir, "leaflet.css"), path.join(leafletOut, "leaflet.css"));
	for (const name of fs.readdirSync(path.join(leafletDir, "images"))) {
		if (name.endsWith(".png")) fs.copyFileSync(path.join(leafletDir, "images", name), path.join(leafletOut, "images", name));
	}

	fs.mkdirSync(path.join(out, "vendor/d3"), { recursive: true });
	fs.copyFileSync(path.join(root, "node_modules/d3/dist/d3.min.js"), path.join(out, "vendor/d3/d3.min.js"));

	fs.mkdirSync(path.join(out, "vendor/motion"), { recursive: true });
	fs.copyFileSync(path.join(root, "node_modules/motion/dist/motion.js"), path.join(out, "vendor/motion/motion.js"));

	fs.writeFileSync(path.join(out, "_headers"), HEADERS);
	writeHistorySeed();
}

// The Worker's database starts empty. Bundle the local history file so the next
// request can copy the earlier snapshots in. Missing file ships an empty seed.
function writeHistorySeed() {
	const src = path.join(root, "data", "history.jsonl");
	const dest = path.join(root, "worker", "history-seed.json");
	let snaps = [];
	if (fs.existsSync(src)) {
		snaps = fs.readFileSync(src, "utf8").split("\n").filter(Boolean).flatMap((line) => {
			try { return [JSON.parse(line)]; } catch { return []; }
		});
	}
	fs.writeFileSync(dest, JSON.stringify(snaps));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) stageTrackerAssets();
