#import <Cocoa/Cocoa.h>
#include <sys/sysctl.h>
#include <unistd.h>

static NSString *payloadPath(void) {
    return [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"app"];
}

static NSString *nodePath(void) {
    int arm = 0;
    size_t size = sizeof(arm);
    sysctlbyname("hw.optional.arm64", &arm, &size, NULL, 0);
    return [payloadPath() stringByAppendingPathComponent:
        arm ? @"runtime/darwin-arm64/bin/node" : @"runtime/darwin-x64/bin/node"];
}

@interface FishApp : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property(strong) NSWindow *window;
@property(strong) NSTextField *status;
@property(strong) NSButton *openButton;
@property(strong) NSTask *server;
@property(strong) NSPipe *output;
@property(copy) NSString *url;
@property(strong) NSMutableData *pending;
@property BOOL quitting;
@property BOOL smoke;
@end

@implementation FishApp
- (void)openBrowser:(id)sender {
    if (self.url) [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:self.url]];
}

- (void)showData:(id)sender {
    NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/Cute Fish Stock Picker"];
    [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:path]];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    if (self.smoke) fprintf(stderr, "GUI smoke: application launched\n");
    NSMenu *menu = [NSMenu new];
    NSMenuItem *item = [NSMenuItem new];
    NSMenu *appMenu = [NSMenu new];
    [appMenu addItemWithTitle:@"退出可爱鱼儿选股指南" action:@selector(terminate:) keyEquivalent:@"q"];
    item.submenu = appMenu;
    [menu addItem:item];
    NSApp.mainMenu = menu;

    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 440, 210)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"可爱鱼儿选股指南";
    self.window.delegate = self;
    self.window.releasedWhenClosed = NO;
    NSTextField *title = [NSTextField labelWithString:@"可爱鱼儿选股指南"];
    title.font = [NSFont boldSystemFontOfSize:22];
    title.frame = NSMakeRect(24, 150, 392, 32);
    [self.window.contentView addSubview:title];
    self.status = [NSTextField wrappingLabelWithString:@"正在启动本机服务…"];
    self.status.frame = NSMakeRect(24, 85, 392, 56);
    [self.window.contentView addSubview:self.status];
    self.openButton = [NSButton buttonWithTitle:@"打开选股页面" target:self action:@selector(openBrowser:)];
    self.openButton.frame = NSMakeRect(20, 28, 134, 32);
    self.openButton.enabled = NO;
    [self.window.contentView addSubview:self.openButton];
    NSButton *data = [NSButton buttonWithTitle:@"本机数据" target:self action:@selector(showData:)];
    data.frame = NSMakeRect(166, 28, 112, 32);
    [self.window.contentView addSubview:data];
    NSButton *quit = [NSButton buttonWithTitle:@"退出" target:NSApp action:@selector(terminate:)];
    quit.frame = NSMakeRect(302, 28, 114, 32);
    [self.window.contentView addSubview:quit];
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    if (self.smoke) fprintf(stderr, "GUI smoke: window visible=%d\n", self.window.visible);

    self.pending = [NSMutableData data];
    self.output = [NSPipe pipe];
    self.server = [NSTask new];
    self.server.executableURL = [NSURL fileURLWithPath:nodePath()];
    self.server.arguments = @[@"build/server.mjs"];
    self.server.currentDirectoryURL = [NSURL fileURLWithPath:payloadPath()];
    NSMutableDictionary *env = [[[NSProcessInfo processInfo] environment] mutableCopy];
    env[@"PATH"] = [NSString stringWithFormat:@"/opt/homebrew/bin:/opt/homebrew/opt/python@3.12/bin:/usr/local/bin:%@",
        env[@"PATH"] ?: @"/usr/bin:/bin"];
    env[@"CUTE_FISH_DESKTOP"] = @"1";
    self.server.environment = env;
    self.server.standardInput = [NSFileHandle fileHandleWithNullDevice];
    self.server.standardOutput = self.output;
    // Do not persist API diagnostics or credentials in a second desktop log.
    self.server.standardError = self.smoke ? [NSFileHandle fileHandleWithStandardError] : [NSFileHandle fileHandleWithNullDevice];
    __weak FishApp *weakSelf = self;
    self.output.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = handle.availableData;
        if (!data.length) { handle.readabilityHandler = nil; return; }
        dispatch_async(dispatch_get_main_queue(), ^{
            FishApp *app = weakSelf;
            if (!app) return;
            [app.pending appendData:data];
            NSString *text = [[NSString alloc] initWithData:app.pending encoding:NSUTF8StringEncoding];
            if (!text) return;
            NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:
                @"Cute Fish Stock Picker: (http://127\\.0\\.0\\.1:[0-9]+)\\r?\\n" options:0 error:nil];
            NSTextCheckingResult *match = [pattern firstMatchInString:text options:0 range:NSMakeRange(0, text.length)];
            if (match) {
                app.url = [text substringWithRange:[match rangeAtIndex:1]];
                app.status.stringValue = [NSString stringWithFormat:@"本机服务已就绪\n%@", app.url];
                app.openButton.enabled = YES;
                if (app.smoke) {
                    fprintf(stderr, "GUI smoke: server ready\n");
                    NSString *report = NSProcessInfo.processInfo.environment[@"CUTE_FISH_GUI_TEST_REPORT"];
                    NSDictionary *result = @{@"url": app.url, @"visible": @(app.window.visible)};
                    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
                    if (![json writeToFile:report atomically:YES]) exit(2);
                    [app.window.contentView display];
                    NSBitmapImageRep *bitmap = [app.window.contentView bitmapImageRepForCachingDisplayInRect:app.window.contentView.bounds];
                    [app.window.contentView cacheDisplayInRect:app.window.contentView.bounds toBitmapImageRep:bitmap];
                    [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}]
                        writeToFile:[report stringByAppendingString:@".png"] atomically:YES];
                    fprintf(stderr, "GUI smoke: snapshot saved, quitting\n");
                    [NSApp terminate:nil];
                }
            }
            if (app.pending.length > 65536 || match) [app.pending setLength:0];
        });
    };
    self.server.terminationHandler = ^(NSTask *task) {
        dispatch_async(dispatch_get_main_queue(), ^{
            FishApp *app = weakSelf;
            if (!app || app.quitting) return;
            if (task.terminationStatus == 0) [NSApp terminate:nil];
            else {
                app.status.stringValue = @"启动失败。请重新完整解压下载包，并确认本机数据目录可写。";
                app.openButton.enabled = NO;
            }
        });
    };
    NSError *error = nil;
    if (![self.server launchAndReturnError:&error]) {
        self.status.stringValue = @"无法启动内置运行环境。请重新下载完整 ZIP，并在隐私与安全性中检查拦截提示。";
    }
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    [self.window makeKeyAndOrderFront:nil];
    [self openBrowser:nil];
    return YES;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

- (void)finishTermination:(id)sender {
    if (self.smoke) fprintf(stderr, "GUI smoke: confirming termination\n");
    [NSApp replyToApplicationShouldTerminate:YES];
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    if (self.smoke) fprintf(stderr, "GUI smoke: stopping server\n");
    self.quitting = YES;
    self.output.fileHandleForReading.readabilityHandler = nil;
    if (self.server.running) {
        [self.server terminate];
        // The local server has a bounded three-second graceful shutdown.
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            [self.server waitUntilExit];
            if (self.smoke) fprintf(stderr, "GUI smoke: server stopped\n");
            // NSTerminateLater runs a modal loop. A termination request may
            // already occupy the main dispatch queue, so reply via that loop.
            [self performSelectorOnMainThread:@selector(finishTermination:) withObject:nil waitUntilDone:NO
                modes:@[NSModalPanelRunLoopMode, NSRunLoopCommonModes]];
        });
        return NSTerminateLater;
    }
    return NSTerminateNow;
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        // Run the exact bundled executable in CI without a graphical session.
        if (argc == 2 && strcmp(argv[1], "--headless") == 0) {
            if (chdir(payloadPath().fileSystemRepresentation) != 0) return 1;
            execl(nodePath().fileSystemRepresentation, "node", "build/server.mjs", NULL);
            return 1;
        }
        BOOL smoke = argc == 2 && strcmp(argv[1], "--smoke-gui") == 0;
        if (smoke) fprintf(stderr, "GUI smoke: entering AppKit\n");
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        __attribute__((objc_precise_lifetime)) FishApp *delegate = [FishApp new];
        delegate.smoke = smoke;
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
