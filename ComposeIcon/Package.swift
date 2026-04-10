// swift-tools-version: 6.2
import PackageDescription

let package = Package(
	name: "ComposeIcon",
	platforms: [
		.macOS(.v11)
	],
	products: [
		.executable(
			name: "compose-icon",
			targets: ["ComposeIcon"]
		)
	],
	targets: [
		.executableTarget(
			name: "ComposeIcon"
		)
	]
)
