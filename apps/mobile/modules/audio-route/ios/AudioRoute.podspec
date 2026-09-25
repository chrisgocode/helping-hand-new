Pod::Spec.new do |s|
  s.name           = 'AudioRoute'
  s.version        = '1.0.0'
  s.summary        = 'Reports the active iOS audio route.'
  s.description    = 'Reports which ports the shared audio session is using, and when that changes.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
