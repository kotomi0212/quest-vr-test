"""Static CLI metadata/IL inventory. Never loads or executes vendor code."""
import hashlib
from pathlib import Path
import dnfile
from dncil.cil.body.reader import read_method_body_from_bytes

SELECTED={'Connect','GetData','CorrectData','SetDataToBuffer','SoftwareStart','Start','Stop','Trig','Ext',
          'ReadRawData','RawToEng','ReadFPData','CalculateCOP','COMEstimation_AP','COMEstimation',
          'GetPhysicalParameters','AdToEng','RotateAxis','MakeHeader','SetData','COMEstimation_ML',
          '.ctor','InitializeMFPTask','ToMonitorTask','MonitorTask','BinToAd','MainLoop','DataHandler'}

def inspect(directory,output):
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    for filename in ('MedicalFpAmp.dll','MedicalForcePlate.exe'):
        path=Path(directory)/filename;pe=dnfile.dnPE(str(path));lines=[];owners={}
        for t in pe.net.mdtables.TypeDef:
            name=str(t.TypeNamespace)+'.'+str(t.TypeName)
            for entry in t.MethodList:owners[id(entry.row)]=name
            for entry in t.FieldList:owners[id(entry.row)]=name
        def resolve(value):
            if not hasattr(value,'value'):return str(value)
            token=value.value;table=token>>24;index=token&0xffffff
            if table==0x70:
                return repr(pe.net.user_strings.get(index).value)
            tab=pe.net.mdtables.tables.get(table)
            if tab is None:return str(value)
            row=tab.rows[index-1];name=str(getattr(row,'Name',getattr(row,'TypeName','?')))
            owner=owners.get(id(row),'')
            if hasattr(row,'Class'):
                cls=row.Class.row;owner=str(getattr(cls,'TypeName',getattr(cls,'Name','?')))
            return owner+'::'+name
        lines.append('sha256='+hashlib.sha256(path.read_bytes()).hexdigest())
        for method in pe.net.mdtables.MethodDef:
            if str(method.Name) not in SELECTED:continue
            owner=owners.get(id(method),'')
            if filename.endswith('.exe') and not (owner.endswith('DataHandler') or (owner.endswith('MainForm') and str(method.Name) in ('InitializeMFPTask','ToMonitorTask','MonitorTask'))):continue
            lines.append('\nMETHOD '+owner+'::'+str(method.Name)+' signature='+method.Signature.value.hex()+' flags='+str(method.Flags))
            if not method.Rva:continue
            body=read_method_body_from_bytes(pe.get_data(method.Rva,100000))
            for inst in body.instructions:
                lines.append(f'{inst.offset:04x} {inst.opcode.name} {resolve(inst.operand)}')
        (output/(filename+'.il.txt')).write_text('\n'.join(lines),encoding='utf-8')

if __name__=='__main__':
    import sys
    inspect(sys.argv[1],sys.argv[2])
