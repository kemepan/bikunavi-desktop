#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
#import <dlfcn.h>

typedef void (*MRGetPlayingFunction)(dispatch_queue_t, void (^)(Boolean));

int main(void) {
  @autoreleasepool {
    const char *framework =
      "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote";
    void *handle = dlopen(framework, RTLD_LAZY);
    if (!handle) return 2;

    MRGetPlayingFunction getPlaying =
      (MRGetPlayingFunction)dlsym(handle, "MRMediaRemoteGetNowPlayingApplicationIsPlaying");
    if (!getPlaying) return 3;

    getPlaying(dispatch_get_main_queue(), ^(Boolean playing) {
      puts(playing ? "playing" : "stopped");
      fflush(stdout);
      exit(0);
    });

    dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
      dispatch_get_main_queue(),
      ^{
        puts("unknown");
        fflush(stdout);
        exit(4);
      }
    );
    dispatch_main();
  }
}
