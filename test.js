import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'ava';
import {execa} from 'execa';
import {temporaryDirectory} from 'tempy';
import jestImageSnapshot from 'jest-image-snapshot';

const {configureToMatchImageSnapshot} = jestImageSnapshot;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runCreateDmg = async (args, cwd) => {
	try {
		await execa(path.join(__dirname, 'cli.js'), args, {cwd});
	} catch (error) {
		// Silence code signing failure
		if (!error.message.includes('Code signing failed')) {
			throw error;
		}
	}
};

const getDmgPath = (cwd, name, version) => path.join(cwd, version ? `${name} ${version}.dmg` : `${name}.dmg`);

/**
Validate that the icon for the DMG matches the snapshot (with a small tolerance to avoid flakiness).

Set `UPDATE_SNAPSHOT=true` environment variable to update snapshots.
*/
const assertVolumeIconMatchesSnapshot = async (t, dmgPath) => {
	const existingVolumes = new Set(fs.readdirSync('/Volumes'));
	const mountResult = spawnSync('hdiutil', ['mount', dmgPath], {timeout: 10_000});

	if (mountResult.status !== 0) {
		throw new Error(`Failed to mount DMG: ${mountResult.stderr?.toString()}`);
	}

	const volumes = new Set(fs.readdirSync('/Volumes'));
	const mountLocation = [...volumes].find(volume => !existingVolumes.has(volume));
	if (!mountLocation) {
		throw new Error('Failed to determine DMG mount location.');
	}

	const mountPath = path.join('/Volumes', mountLocation);
	const dirPath = path.dirname(dmgPath);
	const iconPath = path.join(dirPath, 'VolumeIcon.icns');
	const pngPath = path.join(dirPath, 'VolumeIcon.png');

	try {
		const dmgIconPath = path.join(mountPath, '.VolumeIcon.icns');

		if (!fs.existsSync(dmgIconPath)) {
			throw new Error(`Volume icon not found at ${dmgIconPath}`);
		}

		fs.copyFileSync(dmgIconPath, iconPath);

		const sipsResult = spawnSync('sips', ['-s', 'format', 'png', iconPath, '--out', pngPath], {timeout: 10_000});

		if (sipsResult.status !== 0) {
			throw new Error(`Failed to convert icon to PNG: ${sipsResult.stderr?.toString()}`);
		}

		const image = fs.readFileSync(pngPath);

		// Jest-image-snapshot requires a Jest-like context object.
		// We mock the minimum required interface to make it work with AVA.
		const jestContext = {
			testPath: fileURLToPath(import.meta.url),
			currentTestName: t.title,
			snapshotState: {
				_counters: new Map(),
				_updateSnapshot: process.env.UPDATE_SNAPSHOT === 'true' ? 'all' : 'new',
				updated: 0,
				added: 0,
			},
		};

		const result = configureToMatchImageSnapshot({
			failureThreshold: 0.01,
			failureThresholdType: 'percent',
		}).call(jestContext, image);

		if (result.pass) {
			t.pass();
		} else {
			t.fail(result.message());
		}
	} finally {
		// Clean up temp files
		for (const filePath of [iconPath, pngPath]) {
			try {
				fs.unlinkSync(filePath);
			} catch {}
		}

		const unmountResult = spawnSync('hdiutil', ['unmount', '-force', mountPath], {timeout: 10_000});

		if (unmountResult.status !== 0) {
			console.error(`Failed to unmount ${mountLocation}: ${unmountResult.stderr?.toString()}`);
		}
	}
};

test('main', async t => {
	const cwd = temporaryDirectory();

	await runCreateDmg(['--identity=0', path.join(__dirname, 'fixtures/Fixture.app')], cwd);

	const dmgPath = getDmgPath(cwd, 'Fixture', '0.0.1');
	t.true(fs.existsSync(dmgPath));

	await assertVolumeIconMatchesSnapshot(t, dmgPath);
});

test('binary plist', async t => {
	const cwd = temporaryDirectory();

	await runCreateDmg(['--identity=0', path.join(__dirname, 'fixtures/Fixture-with-binary-plist.app')], cwd);

	const dmgPath = getDmgPath(cwd, 'Fixture', '0.0.1');
	t.true(fs.existsSync(dmgPath));

	await assertVolumeIconMatchesSnapshot(t, dmgPath);
});

test('app without icon', async t => {
	const cwd = temporaryDirectory();

	await runCreateDmg(['--identity=0', path.join(__dirname, 'fixtures/Fixture-no-icon.app')], cwd);

	t.true(fs.existsSync(getDmgPath(cwd, 'Fixture', '0.0.1')));
});

test('--no-version-in-filename flag', async t => {
	const cwd = temporaryDirectory();

	await runCreateDmg(['--identity=0', '--no-version-in-filename', path.join(__dirname, 'fixtures/Fixture.app')], cwd);

	t.true(fs.existsSync(getDmgPath(cwd, 'Fixture')));
	t.false(fs.existsSync(getDmgPath(cwd, 'Fixture', '0.0.1')));
});

test('--no-code-sign flag', async t => {
	const cwd = temporaryDirectory();

	// This should succeed without any code signing errors
	await execa(path.join(__dirname, 'cli.js'), ['--no-code-sign', path.join(__dirname, 'fixtures/Fixture.app')], {cwd});

	t.true(fs.existsSync(getDmgPath(cwd, 'Fixture', '0.0.1')));
});

test('app with missing icon file', async t => {
	const cwd = temporaryDirectory();

	await runCreateDmg(['--identity=0', path.join(__dirname, 'fixtures/Fixture-missing-icon.app')], cwd);

	t.true(fs.existsSync(getDmgPath(cwd, 'Fixture', '0.0.1')));
});

test('license agreement with txt', async t => {
	const cwd = temporaryDirectory();
	fs.writeFileSync(path.join(cwd, 'license.txt'), 'This is a test license agreement.\n\nYou must agree to these terms.');

	await runCreateDmg(['--identity=0', path.join(__dirname, 'fixtures/Fixture.app')], cwd);

	t.true(fs.existsSync(getDmgPath(cwd, 'Fixture', '0.0.1')));
});

test('license agreement with rtf', async t => {
	const cwd = temporaryDirectory();
	fs.writeFileSync(path.join(cwd, 'license.rtf'), '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 This is a test license agreement.\\par\\par You must agree to these terms.}');

	await runCreateDmg(['--identity=0', path.join(__dirname, 'fixtures/Fixture.app')], cwd);

	t.true(fs.existsSync(getDmgPath(cwd, 'Fixture', '0.0.1')));
});
