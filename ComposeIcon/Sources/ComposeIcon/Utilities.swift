import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

extension CGContext {
	static func rgbaContext(size: CGSize) -> CGContext? {
		CGContext(
			data: nil,
			width: Int(size.width),
			height: Int(size.height),
			bitsPerComponent: 8,
			bytesPerRow: 0,
			space: CGColorSpaceCreateDeviceRGB(),
			bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
		)
	}
}

extension CGImage {
	var size: CGSize {
		CGSize(width: width, height: height)
	}

	static func load(from url: URL) -> CGImage? {
		guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil) else {
			return nil
		}

		return CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
	}

	func write(to url: URL) -> Bool {
		guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
			return false
		}

		CGImageDestinationAddImage(destination, self, nil)
		return CGImageDestinationFinalize(destination)
	}

	func resized(to size: CGSize) -> CGImage? {
		guard let context = CGContext.rgbaContext(size: size) else {
			return nil
		}

		context.interpolationQuality = .high
		context.draw(self, in: CGRect(origin: .zero, size: size))

		return context.makeImage()
	}

	func overlaying(_ overlay: CGImage, verticalOffset: Double) -> CGImage? {
		guard let context = CGContext.rgbaContext(size: size) else {
			return nil
		}

		// Draw base image
		context.draw(self, in: CGRect(origin: .zero, size: size))

		// Calculate centered position with offset
		// CoreGraphics uses bottom-left origin, positive offset moves overlay up
		let x = Double(width - overlay.width) / 2
		let y = Double(height - overlay.height) / 2 + verticalOffset

		// Draw overlay image
		context.draw(overlay, in: CGRect(origin: CGPoint(x: x, y: y), size: overlay.size))

		return context.makeImage()
	}
}
