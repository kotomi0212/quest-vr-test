// Uses the installed manufacturer's public API. No calibration/configuration setters.
using System;
using System.IO;
using System.Reflection;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;

class ManufacturerCapture {
    static object device; static Type type; static int originalBatch=-1;
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
    static double Clock(){return (double)Stopwatch.GetTimestamp()/Stopwatch.Frequency;}
    static object Get(string name){return type.GetProperty(name).GetValue(device,null);}
    static object Snapshot(string name){
        PropertyInfo property=type.GetProperty(name);ParameterInfo[] indices=property.GetIndexParameters();
        if(indices.Length==0)return Plain(Get(name));
        int[] shape=new int[indices.Length];
        for(int i=0;i<shape.Length;i++){
            if(indices[i].ParameterType.IsEnum)shape[i]=Enum.GetValues(indices[i].ParameterType).Length;
            else if(indices[i].Name=="dv")shape[i]=2;
            else if(indices[i].Name=="item")shape[i]=9;
            else if(name=="Itf6x12")shape[i]=72;
            else if(name=="FullScale")shape[i]=6;
            else if(name=="Prf"||name=="Npu"||name=="ForceZero")shape[i]=12;
            else throw new InvalidOperationException("Unknown indexed property dimensions: "+name);
        }
        var values=new List<object>();int count=1;foreach(int n in shape)count*=n;
        for(int flat=0;flat<count;flat++){
            int remainder=flat;object[] args=new object[shape.Length];
            for(int i=shape.Length-1;i>=0;i--){int j=remainder%shape[i];remainder/=shape[i];args[i]=indices[i].ParameterType.IsEnum?Enum.GetValues(indices[i].ParameterType).GetValue(j):(object)j;}
            values.Add(Plain(property.GetValue(device,args)));
        }
        return new {shape=shape,values=values};
    }
    static object Call(string name,params object[] values){return type.GetMethod(name).Invoke(device,values);}
    static void Wait(){double end=Clock()+8;Thread.Sleep(100);while((bool)Get("HasTask")){if(Clock()>end)throw new TimeoutException("Manufacturer task timeout");Thread.Sleep(10);}}
    static object Plain(object value){
        if(value==null)return null;
        if(value is Array){Array a=(Array)value;var items=new List<object>();foreach(object item in a)items.Add(Plain(item));var dims=new List<int>();for(int i=0;i<a.Rank;i++)dims.Add(a.GetLength(i));return new {shape=dims,values=items};}
        if(value.GetType().IsEnum)return value.ToString();return value;
    }
    static int Main(string[] args){
        if(args.Length<2){Console.Error.WriteLine("ManufacturerCapture vendor_directory NEW_output_directory [capture_seconds]");return 2;}
        string vendor=Path.GetFullPath(args[0]),output=Path.GetFullPath(args[1]);
        if(Directory.Exists(output))throw new IOException("Output already exists");Directory.CreateDirectory(output);
        AppDomain.CurrentDomain.AssemblyResolve+=(sender,eventArgs)=>{
            string path=Path.Combine(vendor,new AssemblyName(eventArgs.Name).Name+".dll");return File.Exists(path)?Assembly.LoadFrom(path):null;
        };
        var json=new JavaScriptSerializer();json.MaxJsonLength=10000000;
        bool timerRequested=false;
        try{
            // The vendor read thread uses Sleep. Pair this temporary request
            // with timeEndPeriod, and record it; this does not improve QPC accuracy.
            if(args.Length>3&&int.Parse(args[3])<=2)timerRequested=timeBeginPeriod(1)==0;
            Assembly assembly=Assembly.LoadFrom(Path.Combine(vendor,"MedicalFpAmp.dll"));type=assembly.GetType("Tecgihan.MedicalFpAmp",true);
            device=Activator.CreateInstance(type,new object[]{"research-sync",false});
            Call("Connect");Wait();Call("GetMainParameters");Call("GetAdditionalParameters");Wait();
            originalBatch=Convert.ToInt32(Get("Matome"));
            if(args.Length>3){int requested=int.Parse(args[3]);if(requested<1||requested>1000)throw new ArgumentException("Invalid requested batch");Call("SetMatome",requested);Wait();if(Convert.ToInt32(Get("Matome"))!=requested)throw new InvalidOperationException("Batch change not confirmed");}
            var data=new Dictionary<string,object>();
            foreach(string name in new[]{"Status","Ready","Serial","Version","Frequency","Matome","Prf","Npu","ForceZero","Itf6x12","AccelRange","AccelBW","GyroRange","GyroBW","AccelPrf","AccelZero","AccelItf","GyroPrf","GyroZero","GyroItf","FpAz0","FpA","FpB","FullScale","PacketLostByteCount","PacketErrorCount"}){
                try{data[name]=Snapshot(name);}catch(Exception e){data[name]="unavailable: "+e.GetType().Name;}
            }
            data["pc_monotonic_s"]=Clock();data["qpc_frequency"]=Stopwatch.Frequency;
            data["original_batch_samples"]=originalBatch;
            data["timer_resolution_1ms_request_succeeded"]=timerRequested;
            data["timing_note"]="Host dequeue/read timestamps only; device acquisition timestamps not yet established";
            File.WriteAllText(Path.Combine(output,"device_parameters.json"),json.Serialize(data));
            Console.WriteLine("Status="+Get("Status")+" frequency="+Get("Frequency")+" matome="+Get("Matome"));
            if(args.Length>2){
                double duration=double.Parse(args[2],System.Globalization.CultureInfo.InvariantCulture);
                if(duration<=0||duration>600)throw new ArgumentException("Capture duration must be 0..600 seconds");
                using(var log=new StreamWriter(new FileStream(Path.Combine(output,"raw_blocks.jsonl"),FileMode.CreateNew))){
                    log.AutoFlush=true;double commanded=Clock();Call("Start");Wait();
                    if(Get("Status").ToString()!="Measure")throw new IOException("Manufacturer device did not enter Measure state");
                    log.WriteLine(json.Serialize(new {kind="capture_start",pc_command_s=commanded,pc_after_task_s=Clock(),status=Get("Status").ToString()}));
                    Console.WriteLine("CAPTURE_READY");Console.Out.Flush();
                    double end=Clock()+duration;int index=0;int matome=Convert.ToInt32(Get("Matome"));
                    if(matome<=0||matome>10000)throw new InvalidOperationException("Invalid batch size");
                    while(Clock()<end&&!File.Exists(Path.Combine(output,"stop.request"))){
                        if(Convert.ToInt32(Get("DataCount"))>0){
                            byte[] bytes=new byte[52*matome];double before=Clock();bool ok=(bool)Call("GetData",new object[]{bytes});double after=Clock();
                            if(!ok)throw new IOException("Manufacturer GetData failed");
                            log.WriteLine(json.Serialize(new {kind="raw_block",block_index=index++,pc_before_read_s=before,pc_after_read_s=after,base64=Convert.ToBase64String(bytes),device_sample_time_known=false}));
                        }else Thread.Sleep(1);
                    }
                    Call("Stop");Wait();log.WriteLine(json.Serialize(new {kind="capture_stop",pc_s=Clock(),blocks=index,packet_lost_bytes=Get("PacketLostByteCount"),packet_errors=Get("PacketErrorCount")}));
                    Console.WriteLine("Saved raw blocks="+index);
                }
            }
            return 0;
        }catch(Exception e){File.WriteAllText(Path.Combine(output,"error.txt"),e.ToString());Console.Error.WriteLine(e);return 1;}
        finally{try{if(device!=null){try{Call("Stop");Wait();if(originalBatch>0&&Convert.ToInt32(Get("Matome"))!=originalBatch){Call("SetMatome",originalBatch);Wait();Console.WriteLine("Restored batch="+Get("Matome"));}Call("Disconnect");Wait();}catch(Exception e){Console.Error.WriteLine("Cleanup: "+e.Message);}}}finally{if(timerRequested)timeEndPeriod(1);}}
    }
}
