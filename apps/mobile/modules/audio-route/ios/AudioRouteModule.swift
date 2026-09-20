import AVFoundation
import ExpoModulesCore

/**
 Reports which ports the shared audio session is actually using.

 Meta documents that starting capture before the Bluetooth hands-free route has
 settled fails silently, so an app that assumes the glasses are the input can end
 up recording the phone instead. Nothing in the Expo audio or speech APIs exposes
 `currentRoute`, which is the only way to tell the difference.
 */
public class AudioRouteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioRoute")

    Events("onRouteChange", "onInterruption")

    Function("getCurrentRoute") { () -> [String: Any] in
      return Self.describe(AVAudioSession.sharedInstance().currentRoute)
    }

    OnStartObserving {
      let center = NotificationCenter.default

      center.addObserver(
        self,
        selector: #selector(self.routeChanged(_:)),
        name: AVAudioSession.routeChangeNotification,
        object: nil
      )

      center.addObserver(
        self,
        selector: #selector(self.interrupted(_:)),
        name: AVAudioSession.interruptionNotification,
        object: nil
      )
    }

    OnStopObserving {
      NotificationCenter.default.removeObserver(self)
    }
  }

  @objc
  private func routeChanged(_ notification: Notification) {
    let rawReason =
      notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
      ?? AVAudioSession.RouteChangeReason.unknown.rawValue

    var payload = Self.describe(AVAudioSession.sharedInstance().currentRoute)
    payload["reason"] = Self.reasonName(rawReason)

    sendEvent("onRouteChange", payload)
  }

  @objc
  private func interrupted(_ notification: Notification) {
    let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt

    sendEvent(
      "onInterruption",
      [
        "began": rawType == AVAudioSession.InterruptionType.began.rawValue
      ]
    )
  }

  private static func describe(_ route: AVAudioSessionRouteDescription) -> [String: Any] {
    return [
      "inputs": route.inputs.map(describe),
      "outputs": route.outputs.map(describe),
    ]
  }

  private static func describe(_ port: AVAudioSessionPortDescription) -> [String: String] {
    return ["portType": port.portType.rawValue, "portName": port.portName]
  }

  private static func reasonName(_ raw: UInt) -> String {
    switch AVAudioSession.RouteChangeReason(rawValue: raw) {
    case .newDeviceAvailable: return "newDeviceAvailable"
    case .oldDeviceUnavailable: return "oldDeviceUnavailable"
    case .categoryChange: return "categoryChange"
    case .override: return "override"
    case .wakeFromSleep: return "wakeFromSleep"
    case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
    case .routeConfigurationChange: return "routeConfigurationChange"
    default: return "unknown"
    }
  }
}
