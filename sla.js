import {Buffer} from 'node:buffer';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import {execa} from 'execa';
import {temporaryFile} from 'tempy';
import plist from 'plist';

// LPic resource: default language 0, count 1, language entry (0, 0, 0)
const LPIC_DATA = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

// STR# resource: button labels for English
// Format: count (2 bytes) + pascal strings (length byte + string)
const STR_DATA = Buffer.from([
	0x00,
	0x06, // 6 strings
	0x07,
	...Buffer.from('English'),
	0x05,
	...Buffer.from('Agree'),
	0x08,
	...Buffer.from('Disagree'),
	0x05,
	...Buffer.from('Print'),
	0x07,
	...Buffer.from('Save...'),
	0x7B,
	...Buffer.from('If you agree with the terms of this license, press "Agree" to install the software.  If you do not agree, press "Disagree".'),
]);

// Styl resource: basic style info
const STYL_DATA = Buffer.from([
	0x00,
	0x01,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
	0x0E,
	0x00,
	0x11,
	0x00,
	0x15,
	0x00,
	0x00,
	0x00,
	0x0C,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
]);

function createRtfFromText(text) {
	let escaped = '';
	for (const char of text) {
		switch (char) {
			case '\\':
			case '{':
			case '}': {
				escaped += `\\${char}`;

				break;
			}

			case '\n': {
				escaped += '\\par\n';

				break;
			}

			case '\r': {
			// ignore

				break;
			}

			default: { escaped += char.codePointAt(0) <= 0x7F ? char : `\\u${char.codePointAt(0)}?`;
			}
		}
	}

	return `{\\rtf1\\ansi\\ansicpg1252\\cocoartf1504\\cocoasubrtf830
{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}
{\\colortbl;\\red255\\green255\\blue255;}
{\\*\\expandedcolortbl;;}
\\pard\\tx560\\tx1120\\tx1680\\tx2240\\tx2800\\tx3360\\tx3920\\tx4480\\tx5040\\tx5600\\tx6160\\txal\\partightenfactor0

\\f0\\fs24 \\cf0 ${escaped}}`;
}

function createResource(id, name, data) {
	return {
		Attributes: '0x0000',
		Data: data,
		ID: String(id),
		Name: name,
	};
}

export default async function sla(dmgPath) {
	const rtfSlaFile = path.join(process.cwd(), 'license.rtf');
	const txtSlaFile = path.join(process.cwd(), 'license.txt');

	const hasRtf = fs.existsSync(rtfSlaFile);
	const hasTxt = fs.existsSync(txtSlaFile);

	if (!hasRtf && !hasTxt) {
		return;
	}

	let rtfData;
	let textData;

	if (hasRtf) {
		rtfData = fs.readFileSync(rtfSlaFile);
		const {stdout} = await execa('/usr/bin/textutil', ['-convert', 'txt', '-stdout', rtfSlaFile]);
		textData = Buffer.from(stdout, 'utf8');
	} else {
		const plainText = fs.readFileSync(txtSlaFile, 'utf8');
		textData = Buffer.from(plainText, 'utf8');
		rtfData = Buffer.from(createRtfFromText(plainText));
	}

	const resources = {
		LPic: [createResource(5000, 'English', LPIC_DATA)],
		'RTF ': [createResource(5000, 'English SLA', rtfData)],
		'STR#': [createResource(5000, 'English', STR_DATA)],
		TEXT: [createResource(5000, 'English SLA', textData)],
		styl: [createResource(5000, 'English', STYL_DATA)],
	};

	const plistContent = plist.build(resources);
	const temporaryPlistPath = temporaryFile({extension: 'plist'});
	fs.writeFileSync(temporaryPlistPath, plistContent);

	try {
		await execa('/usr/bin/hdiutil', ['udifrez', dmgPath, '-xml', temporaryPlistPath]);
	} finally {
		fs.rmSync(temporaryPlistPath, {force: true});
	}
}
