import Foundation

/// Frischer, leerer Ordner unter dem temporären Verzeichnis (Name darf Leerzeichen/Umlaute enthalten).
func tempOrdner(_ name: String? = nil) -> URL {
    let basis = FileManager.default.temporaryDirectory.appendingPathComponent("braintest-\(UUID().uuidString)", isDirectory: true)
    let ordner = name.map { basis.appendingPathComponent($0, isDirectory: true) } ?? basis
    try! FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
    return ordner
}

/// Ausführbares Skript (z. B. ein falsches „node“) mit Inhalt anlegen.
@discardableResult
func skript(_ inhalt: String, name: String = "skript", in ordner: URL) -> URL {
    let url = ordner.appendingPathComponent(name)
    try! inhalt.write(to: url, atomically: true, encoding: .utf8)
    try! FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    return url
}
