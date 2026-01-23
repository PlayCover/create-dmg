import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

// MARK: - Errors

enum ComposeIconError: Error, CustomStringConvertible {
	case invalidArguments
	case loadFailed(URL)
	case perspectiveTransformFailed
	case resizeFailed
	case compositeFailed
	case writeFailed(URL)

	var description: String {
		switch self {
		case .invalidArguments:
			"Usage: compose-icon <app-icon-path> <disk-icon-path> <output-path>"
		case .loadFailed(let url):
			"Error: Could not load image from '\(url.path)'"
		case .perspectiveTransformFailed:
			"Error: Could not apply perspective transformation to app icon"
		case .resizeFailed:
			"Error: Could not resize app icon"
		case .compositeFailed:
			"Error: Could not composite images"
		case .writeFailed(let url):
			"Error: Could not save output image to '\(url.path)'"
		}
	}
}

// MARK: - Layout Constants

private enum Layout {
	/**
	Perspective transform inset factor for the "lying flat" effect.

	Determined empirically to match the original ImageMagick output.
	*/
	static let perspectiveInset = 0.08

	/**
	Resize factor to fit app icon width inside disk icon.

	Determined empirically to match the original ImageMagick output.
	*/
	static let widthResizeFactor = 1.58

	/**
	Resize factor to fit app icon height inside disk icon.

	Determined empirically to match the original ImageMagick output.
	*/
	static let heightResizeFactor = 1.82

	/**
	Vertical offset factor to position app icon correctly on disk icon.

	Determined empirically to match the original ImageMagick output.
	*/
	static let verticalOffsetFactor = 0.063
}

// MARK: - Image Operations

extension CGImage {
	func applyingPerspective(using context: CIContext) throws(ComposeIconError) -> CGImage {
		let ciImage = CIImage(cgImage: self)
		let filter = CIFilter.perspectiveTransform()

		let w = Double(width)
		let h = Double(height)

		filter.inputImage = ciImage
		filter.topLeft = CGPoint(x: w * Layout.perspectiveInset, y: h)
		filter.topRight = CGPoint(x: w * (1 - Layout.perspectiveInset), y: h)
		filter.bottomLeft = CGPoint(x: 0, y: 0)
		filter.bottomRight = CGPoint(x: w, y: 0)

		guard let outputImage = filter.outputImage else {
			throw .perspectiveTransformFailed
		}

		let inputExtent = ciImage.extent
		let croppedImage = outputImage.cropped(to: inputExtent)

		guard let result = context.createCGImage(croppedImage, from: inputExtent) else {
			throw .perspectiveTransformFailed
		}

		return result
	}
}

// MARK: - Main

func run() throws(ComposeIconError) {
	guard CommandLine.arguments.count == 4 else {
		throw .invalidArguments
	}

	let appIconURL = URL(fileURLWithPath: CommandLine.arguments[1])
	let diskIconURL = URL(fileURLWithPath: CommandLine.arguments[2])
	let outputURL = URL(fileURLWithPath: CommandLine.arguments[3])

	guard let appImage = CGImage.load(from: appIconURL) else {
		throw .loadFailed(appIconURL)
	}

	guard let diskImage = CGImage.load(from: diskIconURL) else {
		throw .loadFailed(diskIconURL)
	}

	// Reuse CIContext for efficiency
	let ciContext = CIContext()

	// Apply perspective transformation
	let transformedAppImage = try appImage.applyingPerspective(using: ciContext)

	// Resize app icon to fit inside disk icon
	let resizedSize = CGSize(
		width: (Double(diskImage.width) / Layout.widthResizeFactor).rounded(),
		height: (Double(diskImage.height) / Layout.heightResizeFactor).rounded()
	)

	guard let resizedAppImage = transformedAppImage.resized(to: resizedSize) else {
		throw .resizeFailed
	}

	// Composite images with vertical offset
	let verticalOffset = Double(diskImage.height) * Layout.verticalOffsetFactor

	guard let composedImage = diskImage.overlaying(resizedAppImage, verticalOffset: verticalOffset) else {
		throw .compositeFailed
	}

	guard composedImage.write(to: outputURL) else {
		throw .writeFailed(outputURL)
	}
}

do {
	try run()
} catch {
	fputs("\(error.description)\n", stderr)
	exit(1)
}
