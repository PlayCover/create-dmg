import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execa} from 'execa';
import {temporaryFile} from 'tempy';
import icns from 'icns-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parseImageTypes = buffer => {
	const parsed = icns.parse(buffer);
	const result = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (icns.isImageType(key)) {
			result[key] = value;
		}
	}

	return result;
};

const composeIconUnavailable = Symbol('composeIconUnavailable');

const isComposeIconUnavailable = error => {
	const message = error?.stderr || error?.message || '';
	return error?.code === 'ENOENT'
		|| error?.code === 'EACCES'
		|| message.includes('bad CPU type')
		|| message.includes('not compatible with this version of macOS');
};

// Drive icon from `/System/Library/Extensions/IOStorageFamily.kext/Contents/Resources/Removable.icns`
const baseDiskIconPath = `${__dirname}/disk-icon.icns`;

const swiftExecutablePath = path.join(__dirname, 'compose-icon');

const largestIconType = 'ic10';

async function composeIconVariant(appIconData, diskIconData) {
	const temporaryAppIconPath = temporaryFile({extension: 'png'});
	const temporaryDiskIconPath = temporaryFile({extension: 'png'});
	const temporaryOutputPath = temporaryFile({extension: 'png'});

	try {
		await Promise.all([
			fs.writeFile(temporaryAppIconPath, appIconData),
			fs.writeFile(temporaryDiskIconPath, diskIconData),
		]);

		await execa(swiftExecutablePath, [
			temporaryAppIconPath,
			temporaryDiskIconPath,
			temporaryOutputPath,
		]);

		return await fs.readFile(temporaryOutputPath);
	} catch (error) {
		if (isComposeIconUnavailable(error)) {
			const unavailableError = new Error('compose-icon is unavailable');
			unavailableError.code = composeIconUnavailable;
			unavailableError.cause = error;
			throw unavailableError;
		}

		throw new Error(`Swift image processing failed: ${error.stderr || error.message}`);
	} finally {
		await Promise.all([
			fs.rm(temporaryAppIconPath, {force: true}),
			fs.rm(temporaryDiskIconPath, {force: true}),
			fs.rm(temporaryOutputPath, {force: true}),
		]);
	}
}

export default async function composeIcon(appIconPath) {
	try {
		await fs.access(swiftExecutablePath, fsConstants.X_OK);
	} catch {
		return baseDiskIconPath;
	}

	let baseDiskIconsData;
	let appIconData;
	try {
		[baseDiskIconsData, appIconData] = await Promise.all([
			fs.readFile(baseDiskIconPath),
			fs.readFile(appIconPath),
		]);
	} catch {
		return baseDiskIconPath;
	}

	const baseDiskIcons = parseImageTypes(baseDiskIconsData);
	const appIcons = parseImageTypes(appIconData);

	if (Object.keys(baseDiskIcons).length === 0 || Object.keys(appIcons).length === 0) {
		console.warn('No usable icon variants found, falling back to base disk icon.');
		return baseDiskIconPath;
	}

	const composedIcon = {};

	try {
		await Promise.all(Object.entries(appIcons).map(async ([type, icon]) => {
			if (baseDiskIcons[type]) {
				composedIcon[type] = await composeIconVariant(icon, baseDiskIcons[type]);
				return;
			}

			console.warn('There is no base image for this type', type);
		}));

		if (!composedIcon[largestIconType]) {
			// Make sure the highest-resolution variant is generated
			const largestAppIcon = Object.values(appIcons).sort((a, b) => b.byteLength - a.byteLength)[0];
			const largestDiskIcon = baseDiskIcons[largestIconType] ?? Object.values(baseDiskIcons).sort((a, b) => b.byteLength - a.byteLength)[0];

			if (!largestDiskIcon) {
				console.warn('No base disk icon variants available for composition.');
				return baseDiskIconPath;
			}

			composedIcon[largestIconType] = await composeIconVariant(largestAppIcon, largestDiskIcon);
		}
	} catch (error) {
		if (error?.code === composeIconUnavailable) {
			console.warn('compose-icon is unavailable, falling back to base disk icon.');
			return baseDiskIconPath;
		}

		throw error;
	}

	const temporaryComposedIcon = temporaryFile({extension: 'icns'});

	await fs.writeFile(temporaryComposedIcon, icns.format(composedIcon));

	return temporaryComposedIcon;
}
